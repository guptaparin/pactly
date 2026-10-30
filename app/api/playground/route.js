// Chat playground API: turns browser messages and button taps into Telegram-shaped updates
// and runs them through the real bot (lib/telegram.js). Outgoing bot messages land in the transcript.
import { NextResponse } from "next/server";
import { handleUpdate } from "@/lib/telegram";
import { appendUser, readLog, saveImage, validChat } from "@/lib/playground";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PEOPLE = {
  riya: { id: 900001, first_name: "Riya", is_bot: false },
  arjun: { id: 900002, first_name: "Arjun", is_bot: false },
  eve: { id: 900003, first_name: "Eve", is_bot: false },
};

export async function GET(req) {
  const chat = new URL(req.url).searchParams.get("chat");
  if (!validChat(chat)) return NextResponse.json({ error: "bad chat id" }, { status: 400 });
  return NextResponse.json({ log: await readLog(chat) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req) {
  const { chat, as, text = "", images = [], callback } = await req.json().catch(() => ({}));
  if (!validChat(chat)) return NextResponse.json({ error: "bad chat id" }, { status: 400 });
  const from = PEOPLE[as];
  if (!from) return NextResponse.json({ error: "unknown person" }, { status: 400 });
  const chatObj = { id: chat, type: "group", title: "Pactly playground" };
  const date = Math.floor(Date.now() / 1000);
  try {
    if (callback) {
      await appendUser(chat, { from: from.first_name, as, tap: callback.label || "button" });
      await handleUpdate({ callback_query: { id: `${chat}:${Date.now()}`, from, data: String(callback.data).slice(0, 64), message: { message_id: callback.messageId, chat: chatObj } } });
    } else {
      const pics = images.filter((x) => typeof x === "string" && /^data:image\/(png|jpe?g|webp);base64,/.test(x) && x.length < 2_000_000).slice(0, 3);
      if (!text.trim() && !pics.length) return NextResponse.json({ error: "Say something first" }, { status: 400 });
      const msgId = await appendUser(chat, { from: from.first_name, as, text: String(text).slice(0, 2000), images: pics.length });
      for (const dataUrl of pics) { // each photo arrives as its own message, like Telegram albums
        const fileId = await saveImage(dataUrl);
        await handleUpdate({ message: { message_id: msgId, date, chat: chatObj, from, photo: [{ file_id: fileId, width: 1024, height: 1024 }] } });
      }
      if (text.trim()) await handleUpdate({ message: { message_id: msgId, date, chat: chatObj, from, text: String(text).slice(0, 2000) } });
    }
    return NextResponse.json({ log: await readLog(chat) });
  } catch (e) {
    return NextResponse.json({ error: e.message, log: await readLog(chat) }, { status: 500 });
  }
}
