import { NextResponse } from "next/server";
import { extractPact } from "@/lib/ai";
import { store, log, heldAmount } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json((await store.all()).map((p) => ({ ...p, held: heldAmount(p) })));
}

export async function POST(req) {
  try {
    const { chat, sellerEmail } = await req.json();
    if (!chat || chat.trim().length < 20) return NextResponse.json({ error: "Paste the deal chat first." }, { status: 400 });
    const ai = await extractPact(chat);
    // Normalise milestone amounts so they always sum to the total.
    let ms = ai.milestones?.length ? ai.milestones : [{ name: "Full delivery", amount: ai.amount, criteria: [ai.summary] }];
    const sum = ms.reduce((s, m) => s + m.amount, 0);
    if (Math.abs(sum - ai.amount) > 0.01) ms = ms.map((m) => ({ ...m, amount: +((m.amount / sum) * ai.amount).toFixed(2) }));
    const pact = {
      id: crypto.randomUUID().slice(0, 8),
      ...ai,
      currency: (ai.currency || "USD").toUpperCase(),
      milestones: ms.map((m) => ({ ...m, status: "pending" })),
      sellerEmail: sellerEmail || "",
      chat,
      status: "draft",
      released: 0,
      createdAt: new Date().toISOString(),
    };
    log(pact, "agent", "pact_drafted", `Extracted ${ms.length} milestone(s), risk ${ai.riskScore}/100`);
    await store.put(pact);
    return NextResponse.json(pact);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
