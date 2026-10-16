# Pactly — AI escrow for deals made in DMs

**Pactly turns any informal chat deal into a PayPal-backed escrow pact, and an AI agent decides when the money moves.**

Freelancers and small sellers close millions of deals in WhatsApp and Instagram chats. Either the buyer pays first and risks a scam, or the seller works first and risks never being paid. Formal escrow is too heavy for a $120 logo job. Pactly makes it one paste.

## How it works
1. **Chat → contract.** Paste the deal chat. The agent extracts parties, price, deadline, milestones and *objectively checkable* acceptance criteria, and scores scam risk.
2. **Pay → hold.** The buyer pays with PayPal using an order with `intent: AUTHORIZE`. Funds are reserved on the buyer's account, not paid out.
3. **Deliver → verify.** The seller submits notes, links and screenshots. A vision-capable model checks every acceptance criterion and recommends release / partial / hold.
4. **Settle.** On acceptance, the agent **captures** that milestone's amount from the authorization (partial captures across milestones, `final_capture` on the last one). Cancelled or failed deals **void** the hold so the buyer is never charged.
5. **Dispute → mediation.** Either side can state their case; a mediator agent proposes a fair split that is executed as a partial capture once both accept.
6. **Autonomous deadline enforcement.** No human click needed: if a milestone passes its deadline with no delivery, the agent voids the PayPal authorization and the buyer's money is released automatically (demo button: *Simulate missed deadline*).
7. **Chat agent (`/agent`).** Manage deals in plain language: "how much is held?", "which pacts need my decision?", or paste a chat to draft a pact. The agent uses function calling over your ledger; any release, revision or cancellation comes back as a **proposal with a Confirm button**, so a human approves every money movement.
8. **Ledger.** An AG Grid ledger shows every pact, held vs released money and risk. Every step is in an audit trail.

## Try it in 60 seconds (for judges)
- **Live demo:** https://pactly-vert.vercel.app
- **See every state instantly:** open **Ledger → Load demo pacts** (settled, partial verdict, dispute, auto-voided deadline, high-risk scam chat). Demo pacts are read-only and never touch PayPal.
- **Live PayPal flow:** New pact → *Use sample chat* → *Draft pact with AI* → pay with the yellow PayPal button using a **US sandbox personal account** → switch to *Seller* and submit work → switch to *Buyer* and settle.
- **Sandbox buyer login (fake money, safe to share):**
  - Email: `sb-fonqm53381183@personal.example.com`
  - Password: `K)&3+uHc`
- Tip: use an incognito window so PayPal doesn't reuse another login. Use a US sandbox buyer; PayPal blocks some same-country payments (for example India to India) even in sandbox.

## PayPal integration
| Capability | Used for |
|---|---|
| JS SDK Buttons (`intent=authorize`) | Buyer funds the pact |
| Orders v2 — create (AUTHORIZE) + authorize | Placing the escrow-style hold |
| Payments v2 — authorization capture (partial, `final_capture`) | Milestone releases and mediated splits |
| Payments v2 — authorization void | Cancellations / deadline failures return funds |
| Orders `payee` | Routes captured funds to the seller's PayPal account |
| Webhooks + signature verification | Reconciling pact state with PayPal |

## AI integration
Google Gemini (`gemini-3.8-flash`, free tier) is the default model, called with a strict JSON response schema so every decision is machine-readable. Anthropic Claude is supported as a drop-in alternative (`AI_PROVIDER=anthropic`).
- **Pact extraction**: chat → contract, milestones, criteria, risk flags (works with Hinglish/mixed-language chats)
- **Delivery verification**: multimodal check of screenshots + notes against each criterion
- **Dispute mediation**: proposes a seller/buyer split with reasoning
- **Conversational agent**: Gemini function calling with tools `list_pacts`, `get_pact`, `draft_pact`, and `propose_release` / `propose_revision` / `propose_cancel` (proposals only — executed by PayPal after human confirmation)

The AI never moves money on its own text: it returns structured decisions, and the server maps them to specific PayPal API calls, with the human party confirming each release.

## Run locally
```bash
git clone <this repo> && cd pactly
npm install
cp .env.example .env.local   # fill in sandbox credentials + free Gemini key
npm run dev                  # http://localhost:3000
```
1. Create a sandbox REST app at https://developer.paypal.com/dashboard/applications/sandbox and copy the client ID/secret (use the client ID for both `PAYPAL_CLIENT_ID` and `NEXT_PUBLIC_PAYPAL_CLIENT_ID`).
2. Use the sandbox **personal** account to pay, and the sandbox **business** account email as the seller.
3. Optional: add a webhook pointing to `/api/webhooks/paypal` and set `PAYPAL_WEBHOOK_ID`.

## Deploy (free, no card)
1. Import the repo at https://vercel.com/new (Hobby plan).
2. In the project, open **Storage → Create → Upstash for Redis** (free) and connect it; this injects `KV_REST_API_URL` / `KV_REST_API_TOKEN`.
3. Add the variables from `.env.example` under **Settings → Environment Variables** and redeploy.

Without Redis configured, pacts are stored in `data/pacts.json` (fine for local development).

## Notes and limits
- Sandbox only. PayPal authorizations are honored for 3 days and valid up to 29 days, which fits short gig deals; longer deals would re-authorize.
- Storage: Upstash Redis in production, JSON file locally (`lib/store.js`).

## License
MIT
