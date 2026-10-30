// One-time bot setup: registers this deployment as the bot's webhook and sets its commands.
// Open /api/telegram/setup?key=<TELEGRAM_WEBHOOK_SECRET> after deploying.
import { NextResponse } from "next/server";
import { setupBot } from "@/lib/telegram";
import { appUrl } from "@/lib/pacts";

export const dynamic = "force-dynamic";

export async function GET(req) {
  const key = new URL(req.url).searchParams.get("key");
  if (!process.env.TELEGRAM_BOT_TOKEN) return NextResponse.json({ error: "Set TELEGRAM_BOT_TOKEN first" }, { status: 400 });
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || key !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Set TELEGRAM_WEBHOOK_SECRET and pass it as ?key=" }, { status: 401 });
  }
  try { return NextResponse.json({ ok: true, ...(await setupBot(appUrl())) }); }
  catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
