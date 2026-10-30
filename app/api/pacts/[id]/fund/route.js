// Funding link for chats and agents: creates the AUTHORIZE order and sends the buyer to PayPal's approval page.
import { NextResponse } from "next/server";
import { runAction } from "@/lib/actions";
import { store } from "@/lib/store";
import { appUrl } from "@/lib/pacts";

export const dynamic = "force-dynamic";

export async function GET(_req, { params }) {
  const base = appUrl();
  const p = await store.get(params.id);
  if (!p) return NextResponse.redirect(`${base}/`);
  if (p.status !== "draft" || p.demo) return NextResponse.redirect(`${base}/pact/${p.id}`);
  try {
    const { approveUrl } = await runAction(p.id, "order-redirect", {
      returnUrl: `${base}/api/pacts/${p.id}/paypal-return`,
      cancelUrl: `${base}/pact/${p.id}?cancelled=1`,
    }, { via: "link" });
    return NextResponse.redirect(approveUrl);
  } catch (e) {
    return NextResponse.redirect(`${base}/pact/${p.id}?error=${encodeURIComponent(e.message.slice(0, 200))}`);
  }
}
