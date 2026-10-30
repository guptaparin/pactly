import { NextResponse } from "next/server";
import { CLIENT_ID } from "@/lib/paypal";
export const dynamic = "force-dynamic";
// Public runtime config (no rebuild needed when env changes).
export async function GET() {
  return NextResponse.json({
    paypalClientId: CLIENT_ID(),
    telegramBot: (process.env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, ""),
    mcpNeedsKey: !!process.env.MCP_API_KEY,
  });
}
