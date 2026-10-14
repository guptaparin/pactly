// PayPal webhook receiver: verifies signature, then reconciles pact state with PayPal's truth.
import { NextResponse } from "next/server";
import { paypal } from "@/lib/paypal";
import { store, log } from "@/lib/store";

export async function POST(req) {
  const event = await req.json();
  if (process.env.PAYPAL_WEBHOOK_ID) {
    const v = await paypal.verifyWebhook(req.headers, event).catch(() => ({}));
    if (v.verification_status !== "SUCCESS") return NextResponse.json({ ok: false }, { status: 401 });
  }
  const r = event.resource || {};
  const authId = r.supplementary_data?.related_ids?.authorization_id || r.id;
  const pact = (await store.all()).find((p) => p.authorizationId === authId);
  if (pact) {
    await store.update(pact.id, (p) => {
      log(p, "paypal", "webhook", `${event.event_type} (${r.status || ""})`);
      if (event.event_type === "PAYMENT.AUTHORIZATION.VOIDED") p.status = p.released > 0 ? "settled" : "voided";
    });
  }
  return NextResponse.json({ ok: true });
}
