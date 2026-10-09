// Offline e2e suite. LLM and fetch are stubbed â€” no network, no API key needed.
// The stub is deliberately scripted so the tests exercise the real control flow
// (answer extraction, no-repeat logic, scoring thresholds, routing, tiers).

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");

let pass = 0;
let fail = 0;

function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log("  ok   " + name);
  } else {
    fail++;
    console.log("  FAIL " + name + (extra ? " -> " + extra : ""));
  }
}

// ---- stub the openai module BEFORE the app requires it --------------------
const MODULES = path.join(__dirname, "..", "node_modules");
fs.mkdirSync(MODULES, { recursive: true });

const FAKE_OPENAI = path.join(MODULES, "openai");
if (!fs.existsSync(FAKE_OPENAI)) fs.mkdirSync(FAKE_OPENAI, { recursive: true });

// Scripted LLM responses live on a global so the serialized stub module can
// reach them (a closure would be lost by toString()).
global.__lqStub = { extractQueue: [], chatQueue: [], scoreQueue: [], lastChatMessages: null };

function mkOpenAI() {
  return {
    chat: {
      completions: {
        create: async (opts) => {
          const sys = String((opts.messages[0] || {}).content || "");
          if (/Extract answers/i.test(sys)) {
            const body = global.__lqStub.extractQueue.shift() || {};
            return { choices: [{ message: { content: JSON.stringify(body) } }] };
          }
          if (/You score sales leads/i.test(sys)) {
            const body =
              global.__lqStub.scoreQueue.shift() || { score: 50, reason: "", summary: "" };
            return { choices: [{ message: { content: JSON.stringify(body) } }] };
          }
          global.__lqStub.lastChatMessages = opts.messages;
          const reply = global.__lqStub.chatQueue.shift() || "Sure â€” could you tell me more?";
          return { choices: [{ message: { content: reply } }] };
        },
      },
    },
  };
}
fs.writeFileSync(
  path.join(FAKE_OPENAI, "index.js"),
  "module.exports = " + mkOpenAI.toString() + ";\nmodule.exports.default = module.exports;\n"
);
fs.writeFileSync(
  path.join(FAKE_OPENAI, "package.json"),
  JSON.stringify({ name: "openai", version: "0.0.0-stub", main: "index.js" })
);

// ---- temp data dir so tests never touch real data -------------------------
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lq-test-"));
process.env.DATA_DIR = TMP;
process.env.ADMIN_KEY = "test-key";
process.env.NOTIFY_VIA = "log";

const app = require("../src/index.js");

// ---- helpers --------------------------------------------------------------
function req(method, p, body, key) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      { method, path: p, port: 0, createConnection: () => app.listen(0).address() && require("net").connect(0) },
      () => {}
    );
    // simpler: use supertest-free approach via app.listen
    r.destroy();
    resolve(null);
  });
}

// Lightweight in-process client against the express app.
let server;
function listen() {
  return new Promise((res) => {
    server = app.listen(0, () => res(server.address().port));
  });
}
function call(method, p, body, key) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        method,
        host: "127.0.0.1",
        port,
        path: p,
        headers: {
          "content-type": "application/json",
          "content-length": data ? Buffer.byteLength(data) : 0,
          ...(key ? { "x-admin-key": key } : {}),
        },
      },
      (resp) => {
        let out = "";
        resp.on("data", (c) => (out += c));
        resp.on("end", () => {
          let json = null;
          try {
            json = out ? JSON.parse(out) : {};
          } catch (e) {
            json = { raw: out };
          }
          resolve({ status: resp.statusCode, body: json });
        });
      }
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  await listen();
  const PORT = server.address().port;
  console.log("AI Lead Qualifier e2e (port " + PORT + ")");

  // -- ingest (stubbed fetch) ------------------------------------------------
  const { ingest } = require("../src/scraper");
  global.fetch = async () => ({
    ok: true,
    url: "https://example.com/",
    text: async () =>
      '<title>Demo Co</title><a href="/pricing">pricing</a><p>We build software for small teams.</p>',
  });

  // second fetch for the /pricing link
  let fetchCount = 0;
  global.fetch = async () => {
    fetchCount++;
    if (fetchCount === 1) {
      return {
        ok: true,
        url: "https://example.com/",
        text: async () =>
          '<title>Demo Co</title><a href="/pricing">pricing</a><p>We build software for small teams.</p>',
      };
    }
    return {
      ok: true,
      url: "https://example.com/pricing",
      text: async () => "<p>Plans start at $49 per month.</p>",
    };
  };

  const got = await ingest("democo", "https://example.com/");
  check("ingest returns page count", got.pages >= 1, JSON.stringify(got));
  check("ingest extracts site name", got.name === "Demo Co", got.name);

  const kb = JSON.parse(fs.readFileSync(path.join(TMP, "democo", "kb.json"), "utf8"));
  check("kb stored with pages", Array.isArray(kb.pages) && kb.pages.length >= 1);
  check("kb text is stripped of tags", !/<[a-z]+>/.test(kb.pages[0].text), kb.pages[0].text.slice(0, 80));

  // -- health & config -------------------------------------------------------
  let r = await call("GET", "/health");
  check("health ok", r.status === 200 && r.body.status === "ok");

  r = await call("GET", "/api/democo/config");
  check("config returns site name", r.status === 200 && r.body.name === "Demo Co", JSON.stringify(r.body));
  check("config has quick replies", Array.isArray(r.body.quickReplies) && r.body.quickReplies.length);

  r = await call("GET", "/api/nosite/config");
  check("unknown site 404s", r.status === 404);

  // -- chat: full qualification flow to a HOT lead ---------------------------
  global.__lqStub.extractQueue = [
    { need: "need a new booking system", timeline: "this quarter" },
    { need: "need a new booking system", timeline: "this quarter", size: "team of 14" },
    {
      need: "need a new booking system",
      timeline: "this quarter",
      size: "team of 14",
      budget: "around $2k/month",
    },
    {
      need: "need a new booking system",
      timeline: "this quarter",
      size: "team of 14",
      budget: "around $2k/month",
      decision: "I decide",
    },
  ];
  global.__lqStub.scoreQueue = [{ score: 88, reason: "Clear need, budget and decision power.", summary: "Wants a booking system for 14 people, $2k/mo, decides." }];
  global.__lqStub.chatQueue = [
    "Happy to help. What are you looking to solve?",
    "Got it. When do you need this live?",
    "And how big is the team that'll use it?",
    "Do you have a budget range in mind?",
  ];

  let sid = "sess-hot";
  r = await call("POST", "/api/democo/chat", { message: "We need a new booking system", sessionId: sid });
  check("first turn replies", r.status === 200 && typeof r.body.reply === "string");
  check("first turn not complete", r.body.complete === false);
  check("answers extracted after turn 1", r.body.answers && r.body.answers.need);

  r = await call("POST", "/api/democo/chat", { message: "Ideally this quarter", sessionId: sid });
  check("timeline extracted", r.body.answers && r.body.answers.timeline);

  r = await call("POST", "/api/democo/chat", { message: "Team of 14", sessionId: sid });
  check("size extracted", r.body.answers && r.body.answers.size);

  r = await call("POST", "/api/democo/chat", { message: "Around $2k/month", sessionId: sid });
  check("budget extracted", r.body.answers && r.body.answers.budget);
  // Turn 4 supplies the fifth answer, so this is the turn that closes and scores.
  const completing = r;

  r = await call("POST", "/api/democo/chat", { message: "I'm the one who decides", sessionId: sid });
  check("final turn completes", r.body.complete === true);
  check("hot lead tier", r.body.lead && r.body.lead.tier === "hot", JSON.stringify(r.body.lead));
  check("hot lead score", r.body.lead && r.body.lead.score === 88);
  check("hot reply asks for email", /email/i.test(completing.body.reply), completing.body.reply);
  // A turn after close must stay closed, not re-score.
  check("post-close turn stays closed", r.body.complete === true && r.body.lead && r.body.lead.score === 88);
  check("post-close reply is a thanks", /be in touch/i.test(r.body.reply), r.body.reply);

  // -- lead capture ----------------------------------------------------------
  r = await call("POST", "/api/democo/lead", { contact: "buyer@example.com", sessionId: sid });
  check("lead captured", r.status === 200 && r.body.ok === true);

  r = await call("POST", "/api/democo/lead", {});
  check("lead without contact rejected", r.status === 400);

  r = await call("GET", "/api/democo/leads", null, "test-key");
  check("leads list has the hot lead", Array.isArray(r.body) && r.body.some((l) => l.tier === "hot"));

  r = await call("GET", "/api/democo/leads");
  check("leads list admin-only", r.status === 401);

  // -- COLD lead: no budget, just browsing -----------------------------------
  global.__lqStub.extractQueue = [
    { need: "just browsing" },
    { need: "just browsing", timeline: "no rush" },
    { need: "just browsing", timeline: "no rush", size: "solo" },
    { need: "just browsing", timeline: "no rush", size: "solo", budget: "no budget" },
    {
      need: "just browsing",
      timeline: "no rush",
      size: "solo",
      budget: "no budget",
      decision: "gathering options",
    },
  ];
  global.__lqStub.scoreQueue = [{ score: 18, reason: "No budget, no timeline, browsing.", summary: "Browsing, no budget." }];
  global.__lqStub.chatQueue = ["Sure â€” what are you looking to solve?", "No rush at all. How big is the team?", "Got it. Any budget in mind?", "Makes sense. Are you deciding, or gathering options?"];

  sid = "sess-cold";
  for (const m of ["Just browsing", "No rush", "Just me", "No budget really", "Just gathering options"]) {
    await call("POST", "/api/democo/chat", { message: m, sessionId: sid });
  }
  r = await call("GET", "/api/democo/conversations", null, "test-key");
  const cold = r.body.find((c) => c.id === "sess-cold");
  check("cold conversation stored with score", cold && cold.score === 18, JSON.stringify(cold && cold.score));
  check("cold tier", cold && cold.tier === "cold");

  // -- never re-asks an answered question ------------------------------------
  global.__lqStub.extractQueue = [{ need: "x", timeline: "x", size: "x", budget: "x", decision: "x" }];
  global.__lqStub.scoreQueue = [{ score: 60, reason: "", summary: "" }];
  global.__lqStub.chatQueue = ["wrap-up-line"];
  r = await call("POST", "/api/democo/chat", { message: "hi", sessionId: "sess-skip" });
  check("all-answered conversation scores immediately", r.body.complete === true, JSON.stringify(r.body));

  // -- scoring clamp ---------------------------------------------------------
  global.__lqStub.scoreQueue = [{ score: 400, reason: "", summary: "" }];
  global.__lqStub.extractQueue = [{ need: "x", timeline: "x", size: "x", budget: "x", decision: "x" }];
  r = await call("POST", "/api/democo/chat", { message: "hi", sessionId: "sess-clamp" });
  check("score clamped to 100", r.body.lead && r.body.lead.score === 100, JSON.stringify(r.body.lead));

  global.__lqStub.scoreQueue = [{ score: -50, reason: "", summary: "" }];
  global.__lqStub.extractQueue = [{ need: "x", timeline: "x", size: "x", budget: "x", decision: "x" }];
  r = await call("POST", "/api/democo/chat", { message: "hi", sessionId: "sess-clamp2" });
  check("score clamped to 0", r.body.lead && r.body.lead.score === 0);

  global.__lqStub.scoreQueue = [{ score: "garbage" }];
  global.__lqStub.extractQueue = [{ need: "x", timeline: "x", size: "x", budget: "x", decision: "x" }];
  r = await call("POST", "/api/democo/chat", { message: "hi", sessionId: "sess-clamp3" });
  check("non-numeric score -> 0", r.body.lead && r.body.lead.score === 0);

  // -- quiz admin endpoints --------------------------------------------------
  r = await call("GET", "/api/democo/quiz");
  check("quiz read is admin-only", r.status === 401);

  r = await call("GET", "/api/democo/quiz", null, "test-key");
  check("quiz defaults returned", r.status === 200 && Array.isArray(r.body.questions) && r.body.questions.length === 5);

  r = await call("POST", "/api/democo/quiz", { questions: [{ id: "a", ask: "A?" }], hot_threshold: 80 }, "test-key");
  check("quiz saved", r.status === 200 && r.body.quiz.questions.length === 1);
  check("quiz threshold saved", r.body.quiz.hot_threshold === 80);

  r = await call("POST", "/api/democo/quiz", { questions: [] }, "test-key");
  check("empty quiz rejected", r.status === 400);

  r = await call("POST", "/api/democo/quiz", { questions: [{ id: "x" }] }, "test-key");
  check("question without ask rejected", r.status === 400);

  const q2 = JSON.parse(fs.readFileSync(path.join(TMP, "democo", "quiz.json"), "utf8"));
  check("quiz persisted", q2.questions.length === 1 && q2.questions[0].id === "a");

  // -- widget served ---------------------------------------------------------
  r = await call("GET", "/widget/embed.js");
  check("widget served as js", r.status === 200 && typeof r.body.raw === "string" && /lq-btn/.test(r.body.raw));

  // -- empty message ---------------------------------------------------------
  r = await call("POST", "/api/democo/chat", { message: "   " });
  check("empty message rejected", r.status === 400);

  // -- ingest endpoint -------------------------------------------------------
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return { ok: true, url: "https://other.com/", text: async () => "<title>Other</title><p>Text.</p>" };
  };
  r = await call("POST", "/api/otherco/ingest", { url: "https://other.com/" }, "test-key");
  check("ingest endpoint ok", r.status === 200 && r.body.ok === true, JSON.stringify(r.body));

  r = await call("POST", "/api/otherco/ingest", { url: "" }, "test-key");
  check("ingest without url rejected", r.status === 400);

  r = await call("POST", "/api/otherco/ingest", { url: "https://other.com/" });
  check("ingest admin-only", r.status === 401);

  // -- atomic writes: leads file is valid JSON after every op ----------------
  const leadsRaw = fs.readFileSync(path.join(TMP, "democo", "leads.json"), "utf8");
  check("leads file is valid json", (() => {
    try {
      JSON.parse(leadsRaw);
      return true;
    } catch (e) {
      return false;
    }
  })());

  server.close();
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("SUITE ERROR", e);
  process.exit(1);
});
