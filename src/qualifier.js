// The qualification engine. Decides what to ask, extracts answers from what
// the visitor already said (so we never re-ask), and scores the result.

const { loadKb, loadQuiz, saveConversation, loadConversation, saveLead } = require("./store");
const { systemPrompt, missingQuestions } = require("./prompts");

function client() {
  const { default: OpenAI } = require("openai");
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: base });
}

// Ask the model to pull structured answers out of the conversation so far.
// This is what stops the bot re-asking a question the visitor already answered
// in passing ("we're a team of 12", "we need it by next month").
async function extractAnswers(quiz, messages) {
  const have = quiz.questions
    .map((q) => `${q.id}: ${q.ask}`)
    .join("\n");

  const transcript = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  const res = await client().chat.completions.create({
    model: process.env.MODEL || "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "Extract answers to these questions from the conversation. Reply ONLY with a JSON object mapping each question id to the answer found in the visitor's own words, or null if not answered. Never infer or guess.\n\n" +
          have,
      },
      { role: "user", content: transcript },
    ],
    response_format: { type: "json_object" },
  });

  try {
    const obj = JSON.parse(res.choices[0].message.content || "{}");
    const out = {};
    for (const q of quiz.questions) {
      const v = obj[q.id];
      if (typeof v === "string" && v.trim()) out[q.id] = v.trim();
    }
    return out;
  } catch (e) {
    return {};
  }
}

// Score a qualified conversation 0-100. The model sees the answers and the rubric;
// we clamp and round so a bad model can't produce nonsense.
async function scoreLead(quiz, answers, transcript) {
  if (!Object.keys(answers).length) return 0;

  const sheet = quiz.questions
    .map((q) => `${q.id} (${q.ask}): ${answers[q.id] || "not answered"}`)
    .join("\n");

  const res = await client().chat.completions.create({
    model: process.env.MODEL || "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You score sales leads 0-100. Criteria: clear need (30), real timeline not 'just looking' (20), budget or willingness to spend (20), decision-maker or direct access to one (15), size/scale that fits the service (15). Reply ONLY with a JSON object: {\"score\": number, \"reason\": one short sentence, \"summary\": two sentences on what they need}. Never give a reason to doubt the score.",
      },
      { role: "user", content: `Answers:\n${sheet}\n\nTranscript:\n${transcript}` },
    ],
    response_format: { type: "json_object" },
  });

  try {
    const obj = JSON.parse(res.choices[0].message.content || "{}");
    let s = Number(obj.score);
    if (!Number.isFinite(s)) s = 0;
    s = Math.max(0, Math.min(100, Math.round(s)));
    return {
      score: s,
      reason: typeof obj.reason === "string" ? obj.reason : "",
      summary: typeof obj.summary === "string" ? obj.summary : "",
    };
  } catch (e) {
    return { score: 0, reason: "", summary: "" };
  }
}

function tier(score, quiz) {
  if (score >= quiz.hot_threshold) return "hot";
  if (score >= quiz.warm_threshold) return "warm";
  return "cold";
}

// Main entry: one chat turn.
// 1. Extract what the visitor already answered (no re-asking).
// 2. If we have every answer, score and close out.
// 3. Otherwise reply, working in the next missing question.
async function turn({ site, message, sessionId }) {
  const kb = loadKb(site);
  const quiz = loadQuiz(site);

  let convo = loadConversation(site, sessionId);
  if (!convo) {
    convo = { id: sessionId, site, createdAt: new Date().toISOString(), messages: [], answers: {} };
  }

  convo.messages.push({ role: "user", content: message });

  const answers = await extractAnswers(quiz, convo.messages);
  // Merge: extraction only ever adds. Keeping prior answers means a later turn
  // where the model misses one cannot un-qualify an already-qualified visitor.
  convo.answers = { ...(convo.answers || {}), ...answers };

  const merged = convo.answers || {};
  const missing = missingQuestions(quiz, merged);

  let reply;
  let result = null;

  // A conversation that already scored stays closed. Without this, a trailing
  // "thanks" message would re-run scoring and overwrite the recorded lead.
  if (convo.scoredAt) {
    const t = tier(convo.score, quiz);
    reply =
      "Someone from our team will be in touch" +
      (convo.contact ? " at " + convo.contact : "") +
      ". Thanks again!";
    convo.messages.push({ role: "assistant", content: reply });
    convo.updatedAt = new Date().toISOString();
    saveConversation(site, convo);
    return {
      reply,
      sessionId,
      answers: merged,
      complete: true,
      lead: { score: convo.score, reason: convo.reason || "", summary: convo.summary || "", tier: t, complete: true },
    };
  }

  if (!missing.length) {
    // Fully qualified -> score.
    const transcript = convo.messages.map((m) => `${m.role}: ${m.content}`).join("\n");
    const scored = await scoreLead(quiz, merged, transcript);
    const t = tier(scored.score, quiz);

    result = { ...scored, tier: t, complete: true };

    const opener = {
      hot: "This looks like a strong fit — let me get the right person to reach out to you directly today.",
      warm: "Thanks, that's really helpful. Someone from our team will get back to you within a day with the right next step.",
      cold: "Thanks for your time. I'll pass this on — and if anything changes on your side, we're here.",
    }[t];

    const needContact = !convo.contact;
    reply =
      opener +
      (needContact
        ? " What's the best email to reach you on?"
        : " We'll be in touch at " + convo.contact + ".");

    convo.score = scored.score;
    convo.tier = t;
    convo.scoredAt = new Date().toISOString();
    convo.summary = scored.summary;
    convo.reason = scored.reason;

    saveLead(site, {
      sessionId,
      tier: t,
      score: scored.score,
      reason: scored.reason,
      summary: scored.summary,
      answers: merged,
      at: new Date().toISOString(),
    });
  } else {
    // Normal turn: answer + nudge toward the next question.
    const res = await client().chat.completions.create({
      model: process.env.MODEL || "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        { role: "system", content: systemPrompt(kb, quiz, answers, convo.contact) },
        ...convo.messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
      ],
    });
    reply = (res.choices[0].message.content || "").trim() || "Could you tell me a bit more about what you need?";
  }

  convo.messages.push({ role: "assistant", content: reply });
  convo.updatedAt = new Date().toISOString();
  saveConversation(site, convo);

  return { reply, sessionId, answers, complete: Boolean(result && result.complete), lead: result };
}

module.exports = { turn, extractAnswers, scoreLead, tier, client };
