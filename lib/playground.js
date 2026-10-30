// Chat playground: a browser "group chat" driven by the exact same bot engine as Telegram (lib/telegram.js).
// Chats whose id starts with "pg_" never reach Telegram; the bot's outgoing calls are written to a transcript here.
// This lets judges play buyer, seller and a stranger in one browser, with real PayPal sandbox funding.
import { kv } from "@/lib/store";

export const isPlayground = (chatId) => typeof chatId === "string" && chatId.startsWith("pg_");
export const validChat = (c) => /^pg_[a-z0-9]{8,24}$/.test(c || "");
const LOG = (chat) => `pg:log:${chat}`;
const TTL = 3 * 86400;

export async function readLog(chat) { return (await kv.get(LOG(chat))) || []; }
async function writeLog(chat, log) { await kv.set(LOG(chat), log.slice(-200), TTL); }
const nextId = (log) => log.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1;

export async function appendUser(chat, entry) {
  const log = await readLog(chat);
  const id = nextId(log);
  log.push({ id, kind: "user", at: new Date().toISOString(), ...entry });
  await writeLog(chat, log);
  return id;
}

// Answers the Bot API methods the bot uses, for playground chats.
export async function sink(method, body) {
  const chat = body.chat_id ?? (body.callback_query_id || "").split(":")[0];
  const log = await readLog(chat);
  switch (method) {
    case "sendMessage": {
      const id = nextId(log);
      log.push({ id, kind: "bot", at: new Date().toISOString(), text: body.text, buttons: body.reply_markup?.inline_keyboard || [] });
      await writeLog(chat, log);
      return { message_id: id, chat: { id: chat } };
    }
    case "editMessageText": {
      const m = log.find((x) => x.id === body.message_id);
      if (m) { m.text = body.text; m.buttons = body.reply_markup?.inline_keyboard || []; m.edited = true; await writeLog(chat, log); }
      return true;
    }
    case "editMessageReplyMarkup": {
      const m = log.find((x) => x.id === body.message_id);
      if (m) { m.buttons = body.reply_markup?.inline_keyboard || []; await writeLog(chat, log); }
      return true;
    }
    case "answerCallbackQuery": {
      if (body.text && !body.text.endsWith("…")) { // progress toasts are transient in Telegram; keep only answers
        log.push({ id: nextId(log), kind: "toast", at: new Date().toISOString(), text: body.text, alert: !!body.show_alert });
        await writeLog(chat, log);
      }
      return true;
    }
    case "getFile": return { file_path: body.file_id };
    default: return true; // sendChatAction etc.
  }
}

export const saveImage = async (dataUrl) => {
  const id = `pgf_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await kv.set(`pg:file:${id}`, dataUrl, TTL);
  return id;
};
export const loadImage = (id) => kv.get(`pg:file:${id}`);
