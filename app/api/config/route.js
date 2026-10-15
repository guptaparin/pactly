import { NextResponse } from "next/server";
import { CLIENT_ID } from "@/lib/paypal";
export const dynamic = "force-dynamic";
// Public PayPal client ID served at runtime (no rebuild needed when env changes).
export async function GET() {
  return NextResponse.json({ paypalClientId: CLIENT_ID() });
}
