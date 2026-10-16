import { NextResponse } from "next/server";
import { chat } from "@/lib/assistant";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req) {
  try {
    const { messages } = await req.json();
    if (!Array.isArray(messages) || !messages.length) return NextResponse.json({ error: "No message" }, { status: 400 });
    return NextResponse.json(await chat(messages.slice(-20)));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
