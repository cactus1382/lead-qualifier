// Prompt construction. The qualification loop is the product, so the system
// prompt is written to keep the bot asking rather than answering forever.

function kbContext(kb) {
  if (!kb || !Array.isArray(kb.pages) || !kb.pages.length) {
    return "No site content has been ingested yet. Answer 'I don't have that on hand' style, and steer back to learning what the visitor needs.";
  }
  const chunks = kb.pages
    .slice(0, 12)
    .map((p, i) => `--- page ${i + 1}: ${p.url} ---\n${String(p.text || "").slice(0, 1200)}`)
    .join("\n\n");
  return `Content from the business's own website. Answer ONLY from this. If it isn't here, say you're not certain and that you'll have someone confirm — never invent a price, a date, or a guarantee.\n\n${chunks}`;
}

function missingQuestions(quiz, answers) {
  return quiz.questions.filter((q) => {
    const a = answers[q.id];
    return !a || !String(a).trim();
  });
}

function systemPrompt(kb, quiz, answers, contact) {
  const missing = missingQuestions(quiz, answers);
  const next = missing[0];
  const answered = quiz.questions
    .filter((q) => answers[q.id])
    .map((q) => `- ${q.ask} -> ${answers[q.id]}`)
    .join("\n");

  return `You are the qualification assistant for a business. You have one job: have a short, natural conversation that figures out whether this visitor is a real buyer, and answer their questions from the business's own content.

Rules:
- Be short. Two or three sentences, max. No bullet lists, no headings, no sales voice.
- Answer the visitor's question from the site content below. Never invent anything.
- Ask ONE qualifying question per turn, only when the visitor isn't asking something. Never ask a question that's already answered below.
- Never ask for contact details twice.
- If the visitor is clearly not a buyer (no budget, no need, just browsing, competitor research), stop qualifying, answer their question, and be polite. Don't push.

${next ? `Next question to work in when natural: "${next.ask}"` : "All qualifying questions are answered. Now wrap up: thank them, tell them someone will be in touch, and ask for their email if you don't have it yet."}

Answered so far:
${answered || "(none yet)"}

${contact ? `Contact captured: ${contact}` : "No contact captured yet."}

${kbContext(kb)}`;
}

module.exports = { systemPrompt, kbContext, missingQuestions };
