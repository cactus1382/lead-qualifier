# Next steps — from shipped code to first paying customer

The code is done and tested (43/43 e2e checks passing, live server verified). What's left is all sales, and none of it is hard. In this order:

## 1. Make the demo real (30 minutes)

This is the whole marketing budget. Without it nothing else works.

- [ ] Get an OpenRouter API key (openrouter.ai — works from Iran, has a free tier).
- [ ] Copy `.env.example` to `.env`, fill in `OPENAI_API_KEY` and `OPENAI_BASE_URL=https://openrouter.ai/api/v1`.
- [ ] `npm install && npm start` — server on port 3010.
- [ ] Ingest a real site you can point to: `curl -X POST http://localhost:3010/api/<name>/ingest -H "content-type: application/json" -H "x-admin-key: <ADMIN_KEY>" -d '{"url":"https://that-site.com"}'`
- [ ] Open the widget, run the conversation in `DEMO_SCRIPT.md` end to end, record it. One take, phone is fine.
- [ ] Put the video on the Gumroad listing, on the README, and in every outreach message.

## 2. Gumroad listing (20 minutes)

- [ ] Sign up at gumroad.com with alimb5554@gmail.com.
- [ ] Create the product from `GUMROAD_LISTING.md`. Price $79.
- [ ] Attach the source ZIP (exclude `node_modules`, `.env`).
- [ ] Payouts: Gumroad is merchant-of-record → pays to PayPal/Payoneer. This is how you get paid from Iran without Stripe.

## 3. First 10 conversations (the rest of this week)

The product is a qualification bot, so the cruelest test is qualifying your own prospects. Do it manually at first — you are the bot until the volume justifies the install.

- [ ] 5 businesses you can walk into (Mashhad, phone in hand, demo loaded).
- [ ] 20 agencies by email — they resell this to their clients. Angle: "you sell the site, I add the qualification layer, $400 per client install."
- [ ] Post the r/forhire ad (`G:\vplane\a\reddit_ad.md`) from your own account.
- [ ] Paste the CraftConnect IH comment (`G:\vplane\a\craftconnect_pitch.md`).

## 4. Pricing pressure-test

Ask, don't guess. Two questions per prospect, and use whatever they say:

- "If this qualified one real buyer a week you'd otherwise have missed, what would that be worth to you?"
- "What do you pay for anything else that brings you leads?"

If 3+ say a number near your price, hold. If everyone flinches, the $400 done-for-you is the wrong anchor — lead with $79 self-host and treat the install as an upsell.

## 5. Productize what repeats

After 5 installs you'll see the same thing three times. That's the next product. Write it down each time — the fourth product should come from a pattern you've seen, not an idea you had.

## What NOT to do

- **Do not build product #4 before this one sells.** Three shipped products and zero customers is a hobby.
- **Do not lower the price before anyone has refused it.** Refusal is data; silence is not.
- **Do not skip the demo video.** Every hour you spend on it is worth ten hours of cold email.
