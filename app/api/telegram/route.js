// Telegram webhook. Telegram signs each call with our secret token; duplicates (retries) are dropped.
import { NextResponse } from "next/server";
import { handleUpdate } from "@/lib/telegram";
import { kv } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  if (!process.env.TELEGRAM_BOT_TOKEN) return NextResponse.json({ ok: false, error: "TELEGRAM_BOT_TOKEN not set" });
  const update = await req.json().catch(() => null);
  if (!update?.update_id) return NextResponse.json({ ok: true });
  if (!(await kv.claim(`tg:upd:${update.update_id}`, 86400))) return NextResponse.json({ ok: true, duplicate: true });
  await handleUpdate(update);
  return NextResponse.json({ ok: true });
}
