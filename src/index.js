// AI Lead Qualifier server.
//   GET  /health                  -> liveness
//   GET  /api/:site/config        -> widget config (public)
//   POST /api/:site/chat          -> chat turn (public)
//   POST /api/:site/lead          -> visitor leaves contact (public)
//   GET  /widget/embed.js         -> widget script (public)
//   POST /api/:site/ingest        -> train from a URL (admin)
//   GET  /api/:site/quiz          -> read the 5 questions (admin)
//   POST /api/:site/quiz          -> set the 5 questions (admin)
//   GET  /api/:site/leads         -> scored leads (admin)
//   GET  /api/:site/conversations -> transcripts with scores (admin)

require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { turn } = require("./qualifier");
const { ingest } = require("./scraper");
const {
  loadSite,
  loadKb,
  loadQuiz,
  saveQuiz,
  loadConversation,
  loadLeads,
  saveLead,
  loadConversations,
} = require("./store");

const app = express();
app.use(express.json({ limit: "2mb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", process.env.ALLOWED_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-admin-key");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function adminOnly(req, res, next) {
  const key = req.get("x-admin-key");
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

function siteName(site) {
  const d = loadSite(site);
  return (d && d.name) || site;
}

function notify(site, text) {
  const via = (process.env.NOTIFY_VIA || "log").toLowerCase();
  if (via === "log" || via === "both") {
    console.log(`[qualifier:${site}] ${text}`);
  }
  if (via === "telegram" || via === "both") {
    const token = process.env.BUSINESS_TELEGRAM_TOKEN;
    const chatId = process.env.BUSINESS_TELEGRAM_CHAT_ID;
    if (token && chatId) {
      fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      }).catch(() => {});
    }
  }
}

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/:site/config", (req, res) => {
  const kb = loadKb(req.params.site);
  if (!kb) return res.status(404).json({ error: "unknown site" });
  res.json({
    name: siteName(req.params.site),
    quickReplies: [
      "What do you do?",
      "What are your opening hours?",
      "How much does it cost?",
      "Where are you located?",
    ],
    whatsapp: process.env.BUSINESS_WHATSAPP || "",
    email: process.env.BUSINESS_EMAIL || "",
  });
});

app.post("/api/:site/chat", async (req, res) => {
  const site = req.params.site;
  if (!loadKb(site)) return res.status(404).json({ error: "unknown site" });

  const message = typeof req.body.message === "string" ? req.body.message.trim() : "";
  if (!message) return res.status(400).json({ error: "empty message" });

  const sessionId = req.body.sessionId || crypto.randomUUID();

  try {
    const result = await turn({ site, message, sessionId });

    if (result.complete && result.lead) {
      const l = result.lead;
      const emoji = l.tier === "hot" ? "🔥" : l.tier === "warm" ? "☀️" : "❄️";
      notify(
        site,
        `${emoji} ${l.tier.toUpperCase()} LEAD — score ${l.score}/100\n${l.summary}\nReason: ${l.reason}`
      );
    }

    res.json({
      reply: result.reply,
      sessionId: result.sessionId,
      answers: result.answers,
      complete: result.complete,
      lead: result.lead,
    });
  } catch (e) {
    console.error("chat error:", e && e.message);
    res.status(500).json({ error: "chat failed" });
  }
});

app.post("/api/:site/lead", (req, res) => {
  const site = req.params.site;
  if (!loadKb(site)) return res.status(404).json({ error: "unknown site" });

  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const contact = typeof req.body.contact === "string" ? req.body.contact.trim() : "";
  if (!contact) return res.status(400).json({ error: "contact required" });

  const sessionId = req.body.sessionId || null;
  const convo = sessionId ? loadConversation(site, sessionId) : null;
  if (convo) {
    convo.contact = contact;
    convo.contactAt = new Date().toISOString();
    const all = loadConversations(site);
    const i = all.findIndex((c) => c.id === sessionId);
    if (i >= 0) all[i] = convo;
    else all.push(convo);
    fs.writeFileSync(
      path.join(require("./store").siteDir(site), "conversations.json"),
      JSON.stringify(all, null, 2)
    );
  }

  saveLead(site, {
    sessionId,
    name,
    contact,
    business: siteName(site),
    at: new Date().toISOString(),
  });

  notify(site, `CONTACT: ${name || "(no name)"} — ${contact}`);
  res.json({ ok: true });
});

app.get("/widget/embed.js", (req, res) => {
  const file = path.join(__dirname, "widget.js");
  if (!fs.existsSync(file)) return res.status(404).type("text").send("// widget missing");
  res.type("application/javascript").send(fs.readFileSync(file, "utf8"));
});

app.post("/api/:site/ingest", adminOnly, async (req, res) => {
  const url = typeof req.body.url === "string" ? req.body.url.trim() : "";
  if (!url) return res.status(400).json({ error: "url required" });
  try {
    const result = await ingest(req.params.site, url);
    res.json({ ok: true, pages: result.pages, name: result.name });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

app.get("/api/:site/quiz", adminOnly, (req, res) => {
  res.json(loadQuiz(req.params.site));
});

app.post("/api/:site/quiz", adminOnly, (req, res) => {
  const q = req.body;
  if (!q || !Array.isArray(q.questions) || !q.questions.length) {
    return res.status(400).json({ error: "questions array required" });
  }
  const raw = Array.isArray(q.questions) ? q.questions : [];
  const clean = {
    questions: raw
      .filter((x) => x && x.id && x.ask)
      .map((x) => ({ id: String(x.id), ask: String(x.ask) })),
    hot_threshold: typeof q.hot_threshold === "number" ? q.hot_threshold : 70,
    warm_threshold: typeof q.warm_threshold === "number" ? q.warm_threshold : 40,
  };
  if (!clean.questions.length) return res.status(400).json({ error: "no valid questions" });
  saveQuiz(req.params.site, clean);
  res.json({ ok: true, quiz: clean });
});

app.get("/api/:site/leads", adminOnly, (req, res) => {
  res.json(loadLeads(req.params.site));
});

app.get("/api/:site/conversations", adminOnly, (req, res) => {
  res.json(loadConversations(req.params.site));
});

if (require.main === module) {
  const port = process.env.PORT || 3010;
  app.listen(port, () => {
    console.log(`AI Lead Qualifier listening on http://localhost:${port}`);
    console.log(`Embed: <script src="http://localhost:${port}/widget/embed.js" data-site="yourco"></script>`);
  });
}

module.exports = app;
