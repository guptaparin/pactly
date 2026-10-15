import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { demoPacts } from "@/lib/demo";
export const dynamic = "force-dynamic";

// Load (or refresh) read-only demo pacts so the ledger shows every lifecycle state.
export async function POST() {
  const pacts = demoPacts();
  for (const p of pacts) await store.put(p);
  return NextResponse.json({ loaded: pacts.length });
}
