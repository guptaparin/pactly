// Web entry point for every pact transition. The logic lives in lib/actions.js (shared with Telegram and MCP).
import { NextResponse } from "next/server";
import { runAction, ActionError } from "@/lib/actions";
import { heldAmount } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req, { params }) {
  const body = await req.json().catch(() => ({}));
  try {
    const { pact, orderId } = await runAction(params.id, params.action, body, { via: "web" });
    if (params.action === "order") return NextResponse.json({ id: orderId });
    return NextResponse.json({ ...pact, held: heldAmount(pact) });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e instanceof ActionError ? e.status : 500 });
  }
}
