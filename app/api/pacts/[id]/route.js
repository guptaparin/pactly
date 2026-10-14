import { NextResponse } from "next/server";
import { store, heldAmount } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_req, { params }) {
  const p = await store.get(params.id);
  if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...p, held: heldAmount(p) });
}
