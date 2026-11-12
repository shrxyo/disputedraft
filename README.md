# DisputeDraft

**An AI co-pilot for small PayPal merchants.** It reads each dispute, works out which evidence will win it, drafts the response, and sends it to PayPal once the seller approves.

**Live demo:** https://disputedraft.onrender.com (PayPal sandbox, fictional store "Fernhill Goods")

---

## The problem

When a buyer opens a PayPal dispute or a card chargeback, the seller's money is held and they have a short deadline to respond with the right evidence. Each dispute reason needs different proof:

- "Item not received" needs tracking and proof of delivery.
- "Not as described" needs the listing, photos, and the message history.
- "Unauthorized" needs an address match and the buyer's order history.

Big retailers have teams that handle this. Small sellers often send the wrong evidence or don't respond at all, and they lose cases they could have won.

## What DisputeDraft does

1. **Inbox.** Lists open disputes pulled live from PayPal, with reason, amount, stage, status and deadline.
2. **Investigate.** When you open a dispute, an AI agent calls PayPal (through the PayPal Agent Toolkit) and the store's order records to gather the facts.
3. **Evidence checklist.** Rules for each dispute reason mark every piece of evidence as found, weak or missing.
4. **Strategy.** Recommends whether to fight with evidence, offer a partial refund, or accept the claim. It only recommends actions PayPal currently allows on that dispute.
5. **Draft.** The AI writes the response to PayPal using only facts from the dispute and the order records. It never invents tracking numbers, dates or claims.
6. **Approve & submit.** The seller edits the draft if needed, then submits it. DisputeDraft calls PayPal's Disputes API (provide-evidence, make-offer or send-message), and the status updates.

**The agent investigates; the human approves the action that moves money.**

## Judge instructions

No login is needed. Everything runs against the PayPal **sandbox**, so no real money moves.

1. Open **https://disputedraft.onrender.com**. The inbox shows the store's open sandbox disputes, live from PayPal.
2. Click any dispute row. The detail page shows:
   - the buyer's message and the dispute details from PayPal
   - the **evidence checklist** (found / weak / missing)
   - the **recommended strategy** and why
   - the **AI-drafted response**, which you can edit
   - the **agent trace**, which shows each tool call the agent made to gather facts
3. Click **Re-run AI analysis** to watch the agent investigate from scratch (about 10–30 seconds).
4. Click **Approve & submit to PayPal** to send the response. This is a real sandbox API call. The page shows PayPal's reply, and the dispute's status changes (usually to "waiting for buyer response").

Scenarios to try:

| Product | Dispute reason | What you'll see |
| --- | --- | --- |
| Hand-thrown Ceramic Mug | Item not received | Tracking found, no delivery scan yet: submit tracking evidence |
| Leather Field Notebook | Item not received | Delivered with proof: strong case, submit evidence |
| Soy Candle Trio | Unauthorized (**chargeback** stage) | Address match + order history: submit evidence |
| Linen Throw Blanket | Not as described | Listing was accurate: sends the buyer a message pointing to the listing details |
| Terracotta Planter Set | Not as described | Weak evidence: recommends a partial refund offer |

**Good to know:**

- **Each dispute can be answered once in the app.** After evidence or an offer is submitted, PayPal moves the dispute on and those actions are no longer offered. If another judge already responded, the inbox marks the row **✓ Responded** and the page shows **Response on file with PayPal**, read from PayPal's own record. Pick a different dispute, or tick the checkbox on the inbox to also see disputes that are waiting on the buyer or resolved.
- **We keep fresh disputes available.** Sandbox disputes have a seller deadline, so we open new ones before the old ones expire. If every dispute has already been answered, the saved analyses still show the full AI flow.
- **Reset demo** (on the inbox) clears the app's saved analyses and drafts. It can't undo anything on PayPal's side.
- The AI runs on Gemini's free tier. If a fresh analysis hits a rate limit, wait a minute and try again. Every dispute also has a saved analysis, so the page always shows one.

## How it works

```
Browser (Next.js + AG Grid)
   │
   ├─ GET  /api/disputes                 → PayPal: list disputes
   ├─ POST /api/disputes/:id/analyze     → AI agent (Gemini via Vercel AI SDK)
   │                                          tools: PayPal Agent Toolkit get_dispute,
   │                                                 store order records, store policies
   │                                        → rule-based playbook: checklist + strategy
   │                                        → Gemini: drafts response (structured JSON)
   └─ POST /api/disputes/:id/submit      → PayPal Disputes API
                                              provide-evidence (multipart), make-offer
                                              or send-message
```

| Piece | Where |
| --- | --- |
| Inbox (AG Grid) | `app/Inbox.js` |
| Dispute page | `app/disputes/[id]/` |
| AI agent + drafting | `lib/agent.js` |
| Evidence playbook + strategy rules | `lib/playbook.js` |
| Submit to PayPal | `lib/submit.js` |
| PayPal auth + API helper | `scripts/paypal.js` |
| Mock store data (orders, shipments, messages, policies) | `fixtures/store/` |

**Design choices:**

- **Rules decide, the AI writes.** Which evidence counts, and whether to fight, refund or accept, comes from a deterministic playbook. The AI handles investigation and wording. This keeps recommendations consistent and explainable.
- **Only allowed actions.** The strategy is limited to the actions PayPal lists for that dispute right now, so the app never suggests something PayPal would reject.
- **Grounded drafts.** The model only sees data from PayPal and the store's records, and the prompt forbids inventing facts.

**Built with:** PayPal REST APIs (Disputes, Orders), PayPal Agent Toolkit, Google Gemini via the Vercel AI SDK, Next.js, AG Grid, hosted on Render.

## Run it locally

You need Node 20.12+, a PayPal sandbox app (from the [Developer Dashboard](https://developer.paypal.com/dashboard/)) and a Gemini API key from [Google AI Studio](https://aistudio.google.com/).

```bash
git clone https://github.com/shrxyo/disputedraft.git
cd disputedraft
npm install
cp .env.example .env    # then fill in your PayPal sandbox and Gemini keys
npm run dev             # http://localhost:3000
```

Check your PayPal connection with `node scripts/test-paypal.js`, or open `/api/health`.

**Seeding your own sandbox disputes.** With your own PayPal app you'll start with no disputes. To create them, run:

```bash
node scripts/reseed.js FH-MUG-01 FH-NOTE-04
```

For each product, the script creates and captures a sandbox order (you approve it as the sandbox buyer). It then walks you through opening the dispute as the buyer on sandbox.paypal.com, waits for PayPal to show it, and links it to the store's mock records. SKUs: `FH-MUG-01`, `FH-THROW-02`, `FH-CANDLE-03`, `FH-NOTE-04`, `FH-POT-05`.

## Notes and limits

- Sandbox only. Real merchant onboarding is out of scope.
- The store data (listings, shipments, messages) is mock data for a fictional store.
- Not-as-described disputes at the inquiry stage don't allow provide-evidence in PayPal, so DisputeDraft responds to those with a message to the buyer (send-message) or a refund offer (make-offer).
- Accept-claim isn't wired up: it refunds the buyer in full, and its request format hasn't been verified in the sandbox. A seller can still accept a claim in PayPal directly.
- PayPal's spec doesn't document the multipart format for provide-evidence. `scripts/probe-evidence.js` and `scripts/probe-message.js` are the scripts we used to confirm the request formats against the sandbox.

## License

[MIT](LICENSE)
