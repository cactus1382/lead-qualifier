# AI Lead Qualifier — chat that filters your visitors and pings you only for the real buyers

A website chat widget that does the opposite of a contact form: it *asks questions*.

It greets a visitor, asks the 5 questions that decide whether they're a real buyer (budget, timeline, size, decision power, need), answers their questions from your own site content, then scores the conversation and sends you a Telegram message **only if the lead is hot**. Cold leads go into a daily digest instead of interrupting your day.

Same engine as [SiteChat AI](../website-chatbot): grounded in your own website, cannot invent prices, one-line install. Zero dependencies beyond express + openai. Node >= 18. Any OpenAI-compatible endpoint via `OPENAI_BASE_URL` (works from Iran via OpenRouter).

## What it solves

A contact form gives you 40 emails a week and 38 of them are junk. A "book a demo" button gives you demos with people who will never buy. This bot does the filtering for you — by asking, in conversation, the same questions you'd ask if you were on the phone yourself.

## How a conversation goes

1. Visitor lands. The bot greets and asks what they're looking for.
2. It answers their questions from your own site (it cannot make things up — it quotes your pages or admits it doesn't know).
3. It weaves in the qualifying questions, one at a time, in natural conversation — not a form.
4. When it has what it needs, it scores the lead 0-100 and either:
   - **Hot (>= 70):** pings your Telegram immediately with the score, the answers, and the transcript.
   - **Warm (40-69):** thanks them, promises a reply within a day, goes into your daily digest.
   - **Cold (< 40):** answers their question, asks for their email "in case anything changes", goes into the digest.

## Install

```bash
npm install
npm start
```

Server runs on port 3010. Then on any page:

```html
<script src="http://localhost:3010/widget/embed.js" data-site="yourco"></script>
```

## Configure the 5 questions

Edit `data/yourco/quiz.json`. Defaults (for a service business):

```json
{
  "questions": [
    { "id": "need", "ask": "What are you looking to solve?" },
    { "id": "timeline", "ask": "When do you need this live?" },
    { "id": "size", "ask": "How big is the team that'll use it?" },
    { "id": "budget", "ask": "Do you have a budget range in mind?" },
    { "id": "decision", "ask": "Are you the one who decides, or are you gathering options?" }
  ],
  "hot_threshold": 70,
  "warm_threshold": 40
}
```

The bot asks these in conversation, in whatever order the chat allows, and never repeats one it already has an answer to.

## API

- `GET /health`
- `GET /api/:site/config` — widget config (public)
- `POST /api/:site/chat` — chat turn (public)
- `POST /api/:site/lead` — visitor leaves contact (public)
- `GET /widget/embed.js` — the widget (public)
- `POST /api/:site/ingest` — train from a URL (admin, `x-admin-key`)
- `GET /api/:site/leads` — scored leads (admin)
- `GET /api/:site/conversations` — transcripts with scores (admin)
- `POST /api/:site/quiz` — set the 5 questions + thresholds (admin)

## Env

Copy `.env.example` to `.env`. Required: `OPENAI_API_KEY`. For Telegram hot-lead alerts: `NOTIFY_VIA=telegram`, `BUSINESS_TELEGRAM_TOKEN`, `BUSINESS_TELEGRAM_CHAT_ID`.

## What it does not do

- It does not book meetings. It qualifies; you close.
- It does not email leads for you. The digest is for *you*, about them.
- It reads text, not images. If your pricing is a screenshot, it can't quote it.

## Test

```bash
npm test
```

Offline suite: LLM and fetch are stubbed. Checks the full lifecycle — greeting, question flow without repeating, answering from the knowledge base, scoring, hot-lead Telegram ping, warm/cold routing, contact capture, admin endpoints, server boot, and bad-input handling.

## License

MIT. Use it, resell it, host it for clients.
