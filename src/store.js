// Zero-dependency JSON store. Atomic writes (temp + rename) so a crash
// mid-write can never truncate a client's quiz, leads, or transcripts.

const fs = require("fs");
const path = require("path");

function dataRoot() {
  return process.env.DATA_DIR || path.join(__dirname, "..", "data");
}

function siteDir(site) {
  const safe = String(site || "").replace(/[^a-z0-9-_]/gi, "_");
  const dir = path.join(dataRoot(), safe);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function atomicWrite(file, value) {
  const tmp = file + ".tmp." + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

const DEFAULT_QUIZ = {
  questions: [
    { id: "need", ask: "What are you looking to solve?" },
    { id: "timeline", ask: "When do you need this live?" },
    { id: "size", ask: "How big is the team that'll use it?" },
    { id: "budget", ask: "Do you have a budget range in mind?" },
    { id: "decision", ask: "Are you the one who decides, or are you gathering options?" },
  ],
  hot_threshold: 70,
  warm_threshold: 40,
};

function loadQuiz(site) {
  const q = readJson(path.join(siteDir(site), "quiz.json"), null);
  if (!q || !Array.isArray(q.questions)) return DEFAULT_QUIZ;
  return {
    questions: q.questions,
    hot_threshold: typeof q.hot_threshold === "number" ? q.hot_threshold : 70,
    warm_threshold: typeof q.warm_threshold === "number" ? q.warm_threshold : 40,
  };
}

function saveQuiz(site, quiz) {
  atomicWrite(path.join(siteDir(site), "quiz.json"), quiz);
}

function loadKb(site) {
  return readJson(path.join(siteDir(site), "kb.json"), null);
}

function saveKb(site, kb) {
  atomicWrite(path.join(siteDir(site), "kb.json"), kb);
}

function loadSite(site) {
  return readJson(path.join(siteDir(site), "site.json"), null);
}

function saveSite(site, descriptor) {
  atomicWrite(path.join(siteDir(site), "site.json"), descriptor);
}

function loadConversations(site) {
  return readJson(path.join(siteDir(site), "conversations.json"), []);
}

function saveConversation(site, convo) {
  const all = loadConversations(site);
  const i = all.findIndex((c) => c.id === convo.id);
  if (i >= 0) all[i] = convo;
  else all.push(convo);
  atomicWrite(path.join(siteDir(site), "conversations.json"), all);
}

function loadConversation(site, id) {
  return loadConversations(site).find((c) => c.id === id) || null;
}

function loadLeads(site) {
  return readJson(path.join(siteDir(site), "leads.json"), []);
}

function saveLead(site, lead) {
  const all = loadLeads(site);
  all.push(lead);
  atomicWrite(path.join(siteDir(site), "leads.json"), all);
}

module.exports = {
  dataRoot,
  siteDir,
  DEFAULT_QUIZ,
  loadQuiz,
  saveQuiz,
  loadKb,
  saveKb,
  loadSite,
  saveSite,
  loadConversations,
  loadConversation,
  saveConversation,
  loadLeads,
  saveLead,
};
