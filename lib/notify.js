// Fan-out of pact events to the places the deal lives (today: the Telegram chat it was made in).
// Never throws: a failed notification must not undo or block a money movement.
export async function notify(pact, event, extra = {}) {
  const chat = pact.telegram?.chatId;
  if (!chat || (!String(chat).startsWith("pg_") && !process.env.TELEGRAM_BOT_TOKEN)) return;
  try {
    const { postPactEvent } = await import("@/lib/telegram");
    await postPactEvent(pact, event, extra);
  } catch (e) {
    console.error("notify failed", event, e.message);
  }
}
