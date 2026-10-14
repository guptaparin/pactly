// Every state transition of a pact. The agent decides; PayPal moves (or holds) the money.
import { NextResponse } from "next/server";
import { store, log, heldAmount } from "@/lib/store";
import { paypal } from "@/lib/paypal";
import { verifyDelivery, mediate } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const round = (n) => +Number(n).toFixed(2);

// Capture `percent` of milestone i from the single held authorization.
// The last money-moving event uses final_capture / void so any remainder returns to the buyer.
async function settle(pact, i, percent, actor, reason) {
  const m = pact.milestones[i];
  const amount = round((m.amount * Math.max(0, Math.min(100, percent))) / 100);
  const isLast = pact.milestones.every((x, j) => j === i || ["released", "refunded"].includes(x.status));
  if (amount > 0) {
    const cap = await paypal.capture(pact.authorizationId, amount, pact.currency, isLast);
    m.captureIds = [...(m.captureIds || []), cap.id];
    pact.released = round((pact.released || 0) + amount);
  } else if (isLast) {
    // nothing to capture and this was the last open milestone: release the hold back to the buyer
    try { await paypal.void(pact.authorizationId); } catch (e) { log(pact, "paypal", "void_skipped", e.message); }
  }
  m.status = amount >= m.amount ? "released" : amount > 0 ? "released" : "refunded";
  m.releasedAmount = amount;
  log(pact, actor, amount > 0 ? "funds_captured" : "funds_returned",
    `${m.name}: ${amount} ${pact.currency} to seller (${percent}%). ${reason}`);
  if (isLast) pact.status = "settled";
}

export async function POST(req, { params }) {
  const { id, action } = params;
  const body = await req.json().catch(() => ({}));
  try {
    const pact = store.get(id);
    if (!pact) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const i = body.milestone ?? pact.milestones.findIndex((m) => !["released", "refunded"].includes(m.status));
    const m = pact.milestones[i];

    switch (action) {
      case "order": { // buyer starts funding
        const order = await paypal.createHoldOrder(pact);
        store.update(id, (p) => { p.orderId = order.id; log(p, "buyer", "order_created", order.id); });
        return NextResponse.json({ id: order.id });
      }
      case "authorize": { // buyer approved in PayPal popup -> place the hold
        const r = await paypal.authorizeOrder(body.orderId || pact.orderId);
        const auth = r.purchase_units[0].payments.authorizations[0];
        const p = store.update(id, (p) => {
          p.authorizationId = auth.id;
          p.authExpiresAt = auth.expiration_time;
          p.status = "funded";
          log(p, "paypal", "funds_held", `Authorization ${auth.id} for ${auth.amount.value} ${auth.amount.currency_code}`);
        });
        return NextResponse.json(p);
      }
      case "submit": { // seller delivers -> agent verifies against acceptance criteria
        if (pact.status !== "funded") throw new Error("Pact is not funded yet");
        const verdict = await verifyDelivery(pact, m, body);
        const p = store.update(id, (p) => {
          const mm = p.milestones[i];
          mm.submission = { note: body.note, links: body.links, imageCount: (body.images || []).length, at: new Date().toISOString() };
          mm.verdict = verdict;
          mm.status = "verified";
          log(p, "agent", "delivery_verified", `${mm.name}: ${verdict.decision} (${verdict.releasePercent}%) — ${verdict.summary}`);
        });
        return NextResponse.json(p);
      }
      case "approve": { // buyer accepts the agent's verdict (or overrides to 100%)
        const percent = body.percent ?? m.verdict?.releasePercent ?? 100;
        const p = store.update(id, () => {});
        await settle(p, i, percent, "buyer", body.percent != null ? "Buyer override" : "Buyer accepted agent verdict");
        store.put(p);
        return NextResponse.json(p);
      }
      case "dispute": {
        const proposal = await mediate(pact, m, m.verdict, body.buyerSays || "", body.sellerSays || "");
        const p = store.update(id, (p) => {
          p.milestones[i].dispute = { ...proposal, buyerSays: body.buyerSays, sellerSays: body.sellerSays };
          p.milestones[i].status = "disputed";
          log(p, "agent", "mediation_proposed", `${proposal.sellerPercent}% to seller — ${proposal.reasoning}`);
        });
        return NextResponse.json(p);
      }
      case "resolve": { // both sides accepted the mediation proposal
        const p = store.get(id);
        await settle(p, i, p.milestones[i].dispute.sellerPercent, "agent", "Mediation accepted by both parties");
        store.put(p);
        return NextResponse.json(p);
      }
      case "cancel": { // deadline passed or mutual cancel: void the whole remaining hold
        const p = store.get(id);
        if (p.authorizationId && heldAmount(p) > 0) await paypal.void(p.authorizationId);
        p.milestones.forEach((x) => { if (!["released"].includes(x.status)) x.status = "refunded"; });
        p.status = p.released > 0 ? "settled" : "voided";
        log(p, body.actor || "agent", "hold_voided", body.reason || "Pact cancelled; held funds returned to buyer");
        store.put(p);
        return NextResponse.json(p);
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
