// PayPal sends the buyer back here after approving: place the hold (authorize) and show the pact.
import { NextResponse } from "next/server";
import { runAction } from "@/lib/actions";
import { appUrl } from "@/lib/pacts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req, { params }) {
  const base = appUrl();
  const orderId = new URL(req.url).searchParams.get("token");
  try {
    await runAction(params.id, "authorize", { orderId }, { via: "link" });
    return NextResponse.redirect(`${base}/pact/${params.id}?funded=1`);
  } catch (e) {
    return NextResponse.redirect(`${base}/pact/${params.id}?error=${encodeURIComponent(e.message.slice(0, 200))}`);
  }
}
