// Setup self-check: verifies PayPal sandbox credentials, AI key and storage without exposing secrets.
import { NextResponse } from "next/server";
import { CLIENT_ID, token } from "@/lib/paypal";
export const dynamic = "force-dynamic";

const mask = (v) => (v ? `${v.slice(0, 6)}…${v.slice(-4)} (${v.length} chars)` : "MISSING");

export async function GET() {
  const out = {
    paypalClientId: mask(CLIENT_ID()),
    paypalSecret: process.env.PAYPAL_CLIENT_SECRET ? `set (${process.env.PAYPAL_CLIENT_SECRET.trim().length} chars)` : "MISSING",
    geminiKey: process.env.GEMINI_API_KEY ? "set" : "MISSING",
    storage: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL ? "redis" : "file (not persistent on Vercel)",
  };
  try { await token(); out.paypalSandboxAuth = "OK — client ID and secret are valid sandbox credentials"; }
  catch (e) { out.paypalSandboxAuth = `FAILED — ${e.message}`; }
  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
}
