import { NextResponse } from "next/server";
import { store, heldAmount } from "@/lib/store";
import { enforceDeadlines } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function GET(_req, { params }) {
  const p = await store.get(params.id);
  if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (await enforceDeadlines(p)) await store.put(p);
  return NextResponse.json({ ...p, held: heldAmount(p) });
}
