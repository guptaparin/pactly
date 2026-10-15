// Autonomous agent duties that run without a human click.
// Deadline enforcement: if an open milestone passes its deadline with no delivery,
// the agent voids the remaining PayPal authorization so the buyer gets the held money back.
import { paypal } from "@/lib/paypal";
import { log } from "@/lib/store";

const OPEN = (m) => !["released", "refunded"].includes(m.status);

export async function enforceDeadlines(pact, now = new Date()) {
  if (pact.demo || pact.status !== "funded" || !pact.authorizationId) return false;
  const missed = pact.milestones.find(
    (m) => OPEN(m) && m.status === "pending" && m.deadline && new Date(`${m.deadline}T23:59:59Z`) < now
  );
  if (!missed) return false;
  try {
    await paypal.void(pact.authorizationId);
  } catch (e) {
    log(pact, "agent", "void_failed", e.message);
    return true;
  }
  const returned = pact.milestones.filter(OPEN).reduce((s, m) => s + m.amount, 0);
  pact.milestones.forEach((m) => { if (OPEN(m)) m.status = "refunded"; });
  pact.status = (pact.released || 0) > 0 ? "settled" : "voided";
  log(pact, "agent", "deadline_enforced",
    `"${missed.name}" was due ${missed.deadline} with no delivery. Voided the PayPal authorization; ${returned.toFixed(2)} ${pact.currency} returned to buyer automatically.`);
  return true;
}
