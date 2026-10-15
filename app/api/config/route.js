import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
// Public PayPal client ID served at runtime (no rebuild needed when env changes).
export async function GET() {
  return NextResponse.json({
    paypalClientId: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || process.env.PAYPAL_CLIENT_ID || "",
  });
}
