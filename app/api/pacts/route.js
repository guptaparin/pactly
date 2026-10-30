import { NextResponse } from "next/server";
import { store, heldAmount, returnedAmount, nextAction } from "@/lib/store";
import { createPact } from "@/lib/pacts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json((await store.all()).map((p) => ({ ...p, held: heldAmount(p), returned: returnedAmount(p), nextAction: nextAction(p) })));
}

export async function POST(req) {
  try {
    const { chat, sellerEmail } = await req.json();
    return NextResponse.json(await createPact({ chat, sellerEmail, source: "web" }));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: /Paste/.test(e.message) ? 400 : 500 });
  }
}
