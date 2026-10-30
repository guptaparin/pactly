import { NextResponse } from "next/server";
import { store, heldAmount, returnedAmount, nextAction } from "@/lib/store";
import { tick } from "@/lib/actions";
import { demoPacts } from "@/lib/demo";

export const dynamic = "force-dynamic";

export async function GET(_req, { params }) {
  let p = await store.get(params.id);
  if (!p && params.id.startsWith("demo-")) { // demo links work even before anyone pressed "Load demo pacts"
    for (const d of demoPacts()) await store.put(d);
    p = await store.get(params.id);
  }
  if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
  p = await tick(p); // the agent's autonomous duties run whenever anyone looks at the pact
  return NextResponse.json({ ...p, held: heldAmount(p), returned: returnedAmount(p), nextAction: nextAction(p) });
}
