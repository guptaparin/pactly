// Autonomous agent duties that run without a human click (on page views, Telegram activity and a daily cron).
// They only ever move money in the safe direction (back to the buyer) or keep an existing hold alive.
//  1. Deadline enforcement: an open milestone past its deadline with no delivery -> void the hold, buyer is refunded.
//  2. Hold renewal: PayPal honors an authorization for 3 days; after that the agent reauthorizes it once
//     (valid up to day 29) so a long deal never silently loses its protection.
//  3. Reminders: warn the seller in the chat a day before a deadline.
import { paypal } from "@/lib/paypal";
import { log, heldAmount, kv } from "@/lib/store";

const OPEN = (m) => !["released", "refunded"].includes(m.status);
const HONOR_MS = 3 * 86400000;

export async function enforceDeadlines(pact, now = new Date()) {
  if (pact.demo || pact.status !== "funded" || !pact.authorizationId) return null;
  const missed = pact.milestones.find(
    (m) => OPEN(m) && m.status === "pending" && m.deadline && new Date(`${m.deadline}T23:59:59Z`) < now
  );
  if (!missed) return null;
  try {
    await paypal.void(pact.authorizationId);
  } catch (e) {
    log(pact, "agent", "void_failed", e.message);
    return "void_failed";
  }
  const returned = pact.milestones.filter(OPEN).reduce((s, m) => s + m.amount, 0);
  pact.milestones.forEach((m) => { if (OPEN(m)) m.status = "refunded"; });
  pact.status = (pact.released || 0) > 0 ? "settled" : "voided";
  log(pact, "agent", "deadline_enforced",
    `"${missed.name}" was due ${missed.deadline} with no delivery. Voided the PayPal authorization; ${returned.toFixed(2)} ${pact.currency} returned to buyer automatically.`);
  return "deadline_enforced";
}

export async function maintainHold(pact, now = new Date()) {
  if (pact.demo || pact.status !== "funded" || !pact.authorizationId || pact.reauthorizedAt) return null;
  const created = new Date(pact.authCreatedAt || pact.createdAt).getTime();
  if (now.getTime() < created + HONOR_MS) return null;           // still inside the honor period
  if (pact.authExpiresAt && new Date(pact.authExpiresAt) < now) return null; // too late, nothing to renew
  const amount = heldAmount(pact);
  if (amount <= 0) return null;
  try {
    const r = await paypal.reauthorize(pact.authorizationId, amount, pact.currency);
    const old = pact.authorizationId;
    pact.authorizationId = r.id;
    pact.reauthorizedAt = now.toISOString();
    pact.authCreatedAt = now.toISOString();
    pact.honorEndsAt = new Date(now.getTime() + HONOR_MS).toISOString();
    if (r.expiration_time) pact.authExpiresAt = r.expiration_time;
    log(pact, "agent", "hold_renewed",
      `PayPal's 3-day honor period ended, so the agent reauthorized ${amount.toFixed(2)} ${pact.currency} (${old} → ${r.id}). The buyer's protection stays in place.`);
    return "hold_renewed";
  } catch (e) {
    if (!(await kv.claim(`renewfail:${pact.id}`, 86400))) return null;
    log(pact, "agent", "renew_failed", `Could not reauthorize the hold: ${e.message.slice(0, 160)}`);
    return "renew_failed";
  }
}

export async function remindDeadlines(pact, now = new Date()) {
  if (pact.demo || pact.status !== "funded") return null;
  const soon = pact.milestones.find((m) => OPEN(m) && m.status === "pending" && m.deadline &&
    new Date(`${m.deadline}T23:59:59Z`) - now < 86400000 && new Date(`${m.deadline}T23:59:59Z`) > now);
  if (!soon || !(await kv.claim(`remind:${pact.id}:${soon.name}`, 3 * 86400))) return null;
  log(pact, "agent", "deadline_reminder", `"${soon.name}" is due ${soon.deadline}. If it isn't delivered, the hold is voided and the buyer is refunded.`);
  return "deadline_reminder";
}

// Run every duty; returns the events that happened (callers save the pact and notify).
export async function runDuties(pact, now = new Date()) {
  const events = [];
  for (const duty of [enforceDeadlines, maintainHold, remindDeadlines]) {
    const e = await duty(pact, now);
    if (e) events.push(e);
    if (e === "deadline_enforced") break;
  }
  return events;
}
