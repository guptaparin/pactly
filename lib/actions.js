// The escrow engine: every state transition of a pact, shared by the web app, Telegram bot, chat agent and MCP server.
// The AI recommends; this code decides which PayPal call (if any) is allowed; PayPal moves or holds the money.
import { store, log, heldAmount, kv } from "@/lib/store";
import { paypal } from "@/lib/paypal";
import { verifyDelivery, mediate } from "@/lib/ai";
import { scanForInjection, enforceVerdict } from "@/lib/guard";
import { runDuties } from "@/lib/agent";
import { notify } from "@/lib/notify";

const round = (n) => +Number(n).toFixed(2);
const HONOR_MS = 3 * 86400000;
const OPEN = (m) => !["released", "refunded"].includes(m.status);

export class ActionError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

// Capture `percent` of milestone i from the single held authorization.
// The last money-moving event uses final_capture / void so any remainder returns to the buyer.
async function settle(pact, i, percent, actor, reason) {
  const m = pact.milestones[i];
  const amount = round((m.amount * Math.max(0, Math.min(100, percent))) / 100);
  const isLast = pact.milestones.every((x, j) => j === i || !OPEN(x));
  let captureId;
  if (amount > 0) {
    const cap = await paypal.capture(pact.authorizationId, amount, pact.currency, isLast);
    captureId = cap.id;
    m.captureIds = [...(m.captureIds || []), cap.id];
    pact.released = round((pact.released || 0) + amount);
  } else if (isLast) {
    try { await paypal.void(pact.authorizationId); } catch (e) { log(pact, "paypal", "void_skipped", e.message); }
  }
  m.status = amount > 0 ? "released" : "refunded";
  m.releasedAmount = amount;
  log(pact, actor, amount > 0 ? "funds_captured" : "funds_returned",
    `${m.name}: ${amount.toFixed(2)} ${pact.currency} to seller (${percent}%)${amount < m.amount ? `, ${(m.amount - amount).toFixed(2)} back to buyer` : ""}. ${reason}`,
    captureId ? { paypalId: captureId } : undefined);
  if (isLast) pact.status = (pact.released || 0) > 0 ? "settled" : "voided";

  // Goods deal: register the seller's tracking number on the PayPal capture via the Agent Toolkit.
  const sub = m.submission;
  if (captureId && sub?.trackingNumber && pact.orderId) {
    try {
      const { addShipmentTracking } = await import("@/lib/toolkit");
      await addShipmentTracking({ orderId: pact.orderId, captureId, trackingNumber: sub.trackingNumber, carrier: sub.carrier });
      m.trackingRegistered = true;
      log(pact, "agent", "tracking_added", `Shipment ${sub.carrier || ""} ${sub.trackingNumber} registered on PayPal capture ${captureId} (Agent Toolkit)`.replace(/\s+/g, " "));
    } catch (e) {
      log(pact, "agent", "tracking_failed", `Could not register tracking on PayPal: ${e.message.slice(0, 140)}`);
    }
  }
  return amount;
}

const currentIndex = (pact, body) => body.milestone ?? pact.milestones.findIndex(OPEN);

// ctx.via: "web" | "telegram" | "agent" (AI agent over MCP) ; ctx.actor: display name for the audit trail
export async function runAction(id, action, body = {}, ctx = {}) {
  const pact = await store.get(id);
  if (!pact) throw new ActionError("Pact not found", 404);
  if (pact.demo) throw new ActionError("This is a read-only demo pact. Create a new pact to try the live PayPal flow.");
  const i = currentIndex(pact, body);
  const m = pact.milestones[i];
  const who = (role) => ctx.actor || role;
  const events = [];
  let extra = {};

  switch (action) {
    case "order": { // buyer starts funding with the JS SDK button
      if (pact.status !== "draft") throw new ActionError("This pact is already funded");
      const order = await paypal.createHoldOrder(pact);
      pact.orderId = order.id;
      if (body.agentMayRelease != null) pact.agentMayRelease = !!body.agentMayRelease;
      log(pact, who("buyer"), "order_created", order.id, { paypalId: order.id });
      extra.orderId = order.id;
      break;
    }
    case "order-redirect": { // funding from a chat or agent link: PayPal-hosted approval page
      if (pact.status !== "draft") throw new ActionError("This pact is already funded");
      const order = await paypal.createHoldOrderRedirect(pact, body.returnUrl, body.cancelUrl);
      pact.orderId = order.id;
      log(pact, who("buyer"), "order_created", `${order.id} (PayPal approval link)`, { paypalId: order.id });
      extra.approveUrl = (order.links || []).find((l) => ["payer-action", "approve"].includes(l.rel))?.href;
      if (!extra.approveUrl) throw new ActionError("PayPal did not return an approval link");
      break;
    }
    case "authorize": { // buyer approved in PayPal -> place the hold
      if (pact.status !== "draft") return { pact, events }; // idempotent: return trips and double clicks
      const r = await paypal.authorizeOrder(body.orderId || pact.orderId);
      const auth = r.purchase_units[0].payments.authorizations[0];
      pact.orderId = body.orderId || pact.orderId;
      pact.authorizationId = auth.id;
      pact.authCreatedAt = new Date().toISOString();
      pact.honorEndsAt = new Date(Date.now() + HONOR_MS).toISOString();
      pact.authExpiresAt = auth.expiration_time;
      if (body.agentMayRelease != null) pact.agentMayRelease = !!body.agentMayRelease;
      pact.status = "funded";
      log(pact, "paypal", "funds_held", `Authorization ${auth.id} for ${auth.amount.value} ${auth.amount.currency_code}${pact.agentMayRelease ? ". Buyer allowed AI agents to release milestones the verifier fully approves" : ""}`, { paypalId: auth.id });
      events.push("funds_held");
      break;
    }
    case "submit": { // seller delivers -> guard screens, agent verifies against acceptance criteria
      if (pact.status !== "funded") throw new ActionError("Pact is not funded yet");
      if (!m || m.status !== "pending") throw new ActionError("No milestone is waiting for delivery");
      const sub = {
        note: String(body.note || "").slice(0, 4000),
        links: (body.links || []).slice(0, 10),
        images: (body.images || []).slice(0, 5),
        trackingNumber: body.trackingNumber ? String(body.trackingNumber).trim().slice(0, 64) : "",
        carrier: body.carrier ? String(body.carrier).trim().slice(0, 40) : "",
      };
      const hits = scanForInjection(sub.note, sub.links, sub.trackingNumber, sub.carrier);
      const verdict = enforceVerdict(await verifyDelivery(pact, m, sub), hits);
      m.submission = { note: sub.note, links: sub.links, imageCount: sub.images.length, trackingNumber: sub.trackingNumber, carrier: sub.carrier, at: new Date().toISOString(), by: ctx.actor || "seller", via: ctx.via || "web" };
      m.verdict = verdict;
      m.status = "verified";
      if (verdict.flagged) {
        log(pact, "guard", "injection_blocked", `${m.name}: ${verdict.injection.reasons.join("; ")}. Auto-release disabled for this delivery.`);
        events.push("injection_blocked");
      }
      log(pact, "agent", "delivery_verified", `${m.name}: ${verdict.decision} (${verdict.releasePercent}%) — ${verdict.summary}`);
      events.push("delivery_verified");
      break;
    }
    case "approve": { // release (all or part of) a verified milestone
      if (!m || m.status !== "verified") throw new ActionError("That milestone is not awaiting a decision");
      const v = m.verdict || {};
      const percent = Math.max(0, Math.min(100, Number(body.percent ?? v.releasePercent ?? 100)));
      if (ctx.via === "agent") {
        // AI agents may only release inside the mandate the buyer gave when funding.
        if (!pact.agentMayRelease) throw new ActionError("The buyer has not allowed AI agents to release money on this pact. Ask the buyer to confirm in Pactly.", 403);
        if (v.flagged) throw new ActionError("This delivery was flagged as a manipulation attempt. Only the buyer can decide.", 403);
        if (percent > (v.releasePercent ?? 0)) throw new ActionError(`An agent can release at most what the verifier certified (${v.releasePercent}%).`, 403);
      }
      const reason = ctx.via === "agent" ? `Released by AI agent ${ctx.actor || ""} within the buyer's mandate`.trim()
        : body.percent != null && body.percent !== v.releasePercent ? "Buyer override" : "Buyer accepted agent verdict";
      extra.amount = await settle(pact, i, percent, who(ctx.via === "agent" ? "agent" : "buyer"), reason);
      events.push(extra.amount > 0 ? "funds_captured" : "funds_returned");
      if (pact.status !== "funded") events.push("pact_closed");
      break;
    }
    case "revise": { // buyer asks the seller to fix the work and resubmit; hold stays in place
      if (!m || m.status !== "verified") throw new ActionError("That milestone is not awaiting a decision");
      m.history = [...(m.history || []), { verdict: m.verdict, submission: m.submission }];
      delete m.verdict; delete m.submission;
      m.status = "pending";
      log(pact, who("buyer"), "revision_requested", `${m.name}: seller asked to fix and resubmit (attempt ${m.history.length + 1})${body.reason ? `. ${body.reason}` : ""}`);
      events.push("revision_requested");
      break;
    }
    case "simulate-deadline": { // demo helper: move the open milestone's deadline into the past, then let the agent act
      if (!m || m.status !== "pending") throw new ActionError("No undelivered milestone to expire");
      m.deadline = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      log(pact, "system", "clock_advanced", `Demo: "${m.name}" deadline moved to ${m.deadline}`);
      events.push(...(await runDuties(pact)));
      break;
    }
    case "dispute": {
      if (!m || m.status !== "verified") throw new ActionError("Only a verified delivery can be disputed");
      const proposal = await mediate(pact, m, m.verdict, body.buyerSays || "", body.sellerSays || "");
      proposal.sellerPercent = Math.max(0, Math.min(100, Math.round(proposal.sellerPercent)));
      m.dispute = { ...proposal, buyerSays: body.buyerSays || "", sellerSays: body.sellerSays || "", accepted: {} };
      m.status = "disputed";
      log(pact, "agent", "mediation_proposed", `${proposal.sellerPercent}% to seller — ${proposal.reasoning}`);
      events.push("mediation_proposed");
      break;
    }
    case "accept-mediation": { // each side accepts separately (Telegram); settles when both have
      if (!m || m.status !== "disputed") throw new ActionError("No mediation proposal to accept");
      const side = body.side === "seller" ? "seller" : "buyer";
      m.dispute.accepted = { ...(m.dispute.accepted || {}), [side]: true };
      log(pact, who(side), "mediation_accepted", `${side} accepted ${m.dispute.sellerPercent}% to seller`);
      if (!(m.dispute.accepted.buyer && m.dispute.accepted.seller)) { events.push("mediation_accepted"); break; }
    } // fall through: both accepted
    case "resolve": { // both sides accepted the mediation proposal
      if (!m || m.status !== "disputed") throw new ActionError("No mediation proposal to settle");
      extra.amount = await settle(pact, i, m.dispute.sellerPercent, "agent", "Mediation accepted by both parties");
      events.push(extra.amount > 0 ? "funds_captured" : "funds_returned");
      if (pact.status !== "funded") events.push("pact_closed");
      break;
    }
    case "cancel": { // mutual cancel or buyer protection: void the whole remaining hold
      if (pact.authorizationId && heldAmount(pact) > 0) await paypal.void(pact.authorizationId);
      const back = heldAmount(pact);
      pact.milestones.forEach((x) => { if (x.status !== "released") x.status = "refunded"; });
      pact.status = (pact.released || 0) > 0 ? "settled" : "voided";
      log(pact, who(body.actor || "agent"), "hold_voided", `${body.reason || "Pact cancelled"}. ${back.toFixed(2)} ${pact.currency} returned to buyer.`);
      events.push("hold_voided");
      break;
    }
    default:
      throw new ActionError("Unknown action");
  }

  await store.put(pact);
  for (const e of events) await notify(pact, e, { milestone: i, ...extra });
  return { pact, events, ...extra };
}

// Run autonomous duties on a pact (called on reads, bot activity and the cron); saves + notifies if anything happened.
export async function tick(pact) {
  if (pact.demo || pact.status !== "funded") return pact;
  const events = await runDuties(pact);
  if (!events.length) return pact;
  await store.put(pact);
  for (const e of events) await notify(pact, e, {});
  return pact;
}

// Webhooks and return trips can arrive twice; claim an id once.
export const once = (key, ttl) => kv.claim(`once:${key}`, ttl);
