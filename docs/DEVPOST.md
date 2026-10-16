# Pactly: Devpost submission text

> Paste each section into the matching Devpost field.

## Project name
Pactly

## Tagline (short description)
Deals made in DMs, protected like contracts: an AI escrow agent that turns any chat into a PayPal-backed pact and only releases money when the work actually matches what was promised.

---

## Inspiration
A huge share of small deals now happen in chats: a logo commissioned on Instagram, a website agreed on WhatsApp, a used phone bought from a DM. They run on trust alone, and both sides lose:

- **Buyers** pay first and get nothing. Americans lost **$2.7 billion** to scams that began on social media since 2021, and **44%** of reports in the first half of 2023 were shopping scams, mostly goods that never arrived (FTC data).
- **Sellers** deliver first and get ghosted. **62%** of New York freelancers have lost wages to clients who never paid, and fewer than **1%** took legal action (Authors Guild / Freelancers Union survey, 2022).

Traditional escrow is far too heavy for a $50 logo: forms, fees and days of manual review. We wanted escrow that takes one paste and is run by an agent instead of a back office.

## What it does
1. **Chat → contract.** Paste the deal chat (any language, including Hinglish). The agent extracts parties, price, milestones, deadlines and *objectively checkable* acceptance criteria, and scores scam risk with specific red flags.
2. **Pay → hold.** The buyer pays with PayPal. Pactly creates the order with `intent: AUTHORIZE`, so the money is **held**, not paid out.
3. **Deliver → verify.** The seller submits notes, links and screenshots. A multimodal model checks every acceptance criterion and recommends release, partial release, or hold, explaining each check in plain language. In testing it caught a seller submitting existing brand logos instead of the requested bakery concepts.
4. **Fix → resubmit.** If work falls short, the buyer sends it back with one click. The hold stays in place and the seller sees exactly what to fix.
5. **Settle.** Approval captures that milestone's share of the authorization (partial captures across milestones, `final_capture` on the last). Partial verdicts release a proportional amount.
6. **Disputes.** Both sides state their case; a mediator agent proposes a fair split that executes as a partial capture once both accept.
7. **Autonomous deadline enforcement.** If a milestone deadline passes with no delivery, the agent **voids the PayPal authorization on its own** and the buyer's money is released. No human click is needed.
8. **Talk to your agent.** A chat interface where you manage deals in plain language ("How much is held?", "Which pacts need my decision?", or paste a chat to draft a pact). Any money movement comes back as a **proposal with a Confirm button**.
9. **Ledger.** An AG Grid ledger of every pact with held and released amounts, risk scores and a full audit trail.

## How we built it
- **Frontend:** Next.js 14 (App Router), hand-built CSS, AG Grid Community for the ledger.
- **PayPal (sandbox):**
  - JS SDK Buttons with `intent=authorize` for buyer funding
  - Orders v2: create (AUTHORIZE) and authorize
  - Payments v2: authorization **capture** (partial, `final_capture`) and **void**
  - Order `payee` to route captured funds to the seller
  - Webhooks with signature verification to reconcile state
  - Idempotency keys (`PayPal-Request-Id`) on every write
- **AI:** Google Gemini (Flash) via the Gemini API:
  - Structured JSON outputs (response schemas) for pact extraction, delivery verification and mediation
  - Multimodal input for checking screenshots against criteria
  - Function calling for the chat agent, with tools `list_pacts`, `get_pact`, `draft_pact` and `propose_release` / `propose_revision` / `propose_cancel`
  - Retries and automatic fallback across Flash models for reliability on the free tier
  - The provider layer also supports Anthropic Claude as a drop-in alternative
- **Storage:** Upstash Redis (serverless) with a full audit log per pact.
- **Hosting:** Vercel.

**Design principle: the AI decides, PayPal moves money, and a human confirms.** Every model output is structured JSON that the server maps to a specific PayPal call. The only action the agent takes on its own is *returning* money to the buyer after a missed deadline, the safe direction.

## Challenges we ran into
- **Modelling escrow on PayPal primitives.** One authorization had to cover several milestones, so we used partial captures with `final_capture` on the last milestone and a void for whatever remains. Getting "held" amounts right after partial releases, refunds and voids took careful state design.
- **Making AI verdicts fair, not just strict.** Early versions released 0% when 3 of 4 criteria passed. We reworked the verifier to release proportionally and to tell the seller exactly what to fix, and added a revise-and-resubmit loop.
- **Sandbox realities.** We hit cross-region restrictions (same-country payments blocked in some regions), a retired model version and free-tier overload. We added a health check, runtime config, model fallback and retries so the demo stays reliable.

## Accomplishments that we're proud of
- A working end-to-end flow on live PayPal sandbox: authorize, verify, partial capture, revise, capture, void.
- An agent that takes real autonomous action (deadline voids) while every outgoing payment stays human-confirmed.
- Verification that catches real mismatches (wrong brand names, reused artwork, missing captions) and explains them.

## What we learned
- Authorize/capture is a natural fit for agentic commerce: it gives an agent a safe "hold" state to reason over before money moves.
- Structured outputs and function calling turn an LLM from a chatbot into a component you can trust inside a payment flow.

## What's next for Pactly
- WhatsApp and Instagram bots, so a pact can be created without leaving the chat
- Seller onboarding with PayPal partner flows and payouts in local currencies
- Reputation built from completed pacts
- Reauthorization for deals longer than PayPal's authorization honour period

---

## Built with
nextjs, react, paypal, paypal-orders-api, paypal-payments-api, paypal-js-sdk, paypal-webhooks, gemini, google-ai-studio, ag-grid, upstash-redis, vercel, javascript

## Tools used (AI)
- **Google Gemini (Flash) via the Gemini API.** Pact extraction from chat (structured JSON), multimodal delivery verification against acceptance criteria, dispute mediation, and the conversational agent (function calling over the ledger with proposal-only money tools).
- **Anthropic Claude (optional).** Supported as an alternative provider through the same structured-output interface (`AI_PROVIDER=anthropic`).
- **Claude (coding assistant).** Used during development to help write and debug code.

## Try it
- **Live demo:** https://pactly-vert.vercel.app
- **Repo:** https://github.com/guptaparin/pactly
- **Instant tour:** Ledger → *Load demo pacts* (read-only examples of every state)
- **Sandbox buyer login:** see the README (fake money)
