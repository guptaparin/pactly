// Daily cron (vercel.json): the agent sweeps every funded pact for missed deadlines, holds to renew and reminders.
import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { tick } from "@/lib/actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false }, { status: 401 });
  const funded = (await store.all()).filter((p) => p.status === "funded" && !p.demo);
  const before = Object.fromEntries(funded.map((p) => [p.id, (p.audit || []).length]));
  const results = [];
  for (const p of funded) {
    const after = await tick(p);
    const fresh = (after.audit || []).slice(before[p.id]).map((a) => a.event);
    if (fresh.length) results.push({ id: p.id, events: fresh });
  }
  return NextResponse.json({ ok: true, checked: funded.length, acted: results });
}
