// Setup self-check: verifies PayPal sandbox credentials, AI key and storage without exposing secrets.
import { NextResponse } from "next/server";
import { CLIENT_ID, token } from "@/lib/paypal";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const mask = (v) => (v ? `${v.slice(0, 6)}…${v.slice(-4)} (${v.length} chars)` : "MISSING");

export async function GET(req) {
  const out = {
    paypalClientId: mask(CLIENT_ID()),
    paypalSecret: process.env.PAYPAL_CLIENT_SECRET ? `set (${process.env.PAYPAL_CLIENT_SECRET.trim().length} chars)` : "MISSING",
    geminiKey: process.env.GEMINI_API_KEY ? "set" : "MISSING",
    storage: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL ? "redis" : "file (not persistent on Vercel)",
    telegram: process.env.TELEGRAM_BOT_TOKEN ? `bot token set${process.env.TELEGRAM_WEBHOOK_SECRET ? ", webhook secret set" : ", WEBHOOK SECRET MISSING"}` : "not configured (optional)",
    mcp: process.env.MCP_API_KEY ? "/api/mcp (API key required)" : "/api/mcp (open, demo mode)",
    cron: process.env.CRON_SECRET ? "daily agent sweep protected by CRON_SECRET" : "daily agent sweep (no CRON_SECRET)",
  };
  try { await token(); out.paypalSandboxAuth = "OK — client ID and secret are valid sandbox credentials"; }
  catch (e) { out.paypalSandboxAuth = `FAILED — ${e.message}`; }
  const ai = new URL(req.url).searchParams.get("ai");
  if (ai === "1") out.ai = await (await import("@/lib/ai")).aiPing();
  if (ai === "all") out.aiModels = await (await import("@/lib/ai")).aiProbeAll();
  if (ai === "verify") out.aiVerify = await (await import("@/lib/ai")).aiProbeVerify();
  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
}
