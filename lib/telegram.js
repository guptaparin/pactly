// Pactly inside the chat: a Telegram bot that lives in the group (or DM) where the deal is made.
// It notices when a deal is agreed, drafts the pact from the conversation, sends a PayPal funding link,
// takes deliveries (/deliver with notes, links, photos, tracking numbers), posts the AI verdict,
// and lets each party act with buttons that only work for the right person.
import { store, kv, heldAmount, nextAction } from "@/lib/store";
import { createPact, appUrl, fmt } from "@/lib/pacts";
import { runAction, tick, ActionError } from "@/lib/actions";
import { isPlayground, sink, loadImage } from "@/lib/playground";

const API = () => `${process.env.TELEGRAM_API_BASE || "https://api.telegram.org"}/bot${process.env.TELEGRAM_BOT_TOKEN}`;
const FILE_API = () => `${process.env.TELEGRAM_API_BASE || "https://api.telegram.org"}/file/bot${process.env.TELEGRAM_BOT_TOKEN}`;

export async function tg(method, body) {
  // Playground chats ("pg_…") run the same bot logic but write to a transcript instead of Telegram.
  if (isPlayground(String(body.chat_id ?? "")) || String(body.callback_query_id || "").startsWith("pg_") || String(body.file_id || "").startsWith("pgf_")) {
    return sink(method, body);
  }
  const r = await fetch(`${API()}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!d.ok) throw new Error(`Telegram ${method}: ${d.description || r.status}`);
  return d.result;
}

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const nameOf = (u) => [u?.first_name, u?.last_name].filter(Boolean).join(" ") || u?.username || "Someone";
const btn = (text, data) => ({ text, callback_data: data.slice(0, 64) });
const link = (text, url) => ({ text, url });
const say = (chatId, text, buttons, extra = {}) => tg("sendMessage", {
  chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true,
  ...(buttons ? { reply_markup: { inline_keyboard: buttons.filter((r) => r.length) } } : {}), ...extra,
});

const party = (p, role) => p.telegram?.[role]?.name || p[role] || role;
const open = (m) => !["released", "refunded"].includes(m.status);

// ---------- messages ----------

function pactCard(p) {
  const ms = p.milestones.map((m, i) =>
    `${i + 1}. <b>${esc(m.name)}</b> · ${fmt(m.amount, p.currency)}${m.deadline ? ` · due ${m.deadline}` : ""}\n   <i>${esc(m.criteria.slice(0, 4).join(" · "))}</i>`).join("\n");
  const risky = p.riskScore >= 60;
  const risk = risky
    ? `🚨 <b>Scam risk ${p.riskScore}/100.</b>\n${(p.riskFlags || []).map((f) => `• ${esc(f)}`).join("\n")}\n<b>Never pay outside PayPal.</b> If the seller refuses escrow, walk away.`
    : `🛡️ Scam risk ${p.riskScore}/100${p.riskFlags?.length ? `: ${esc(p.riskFlags[0])}` : ", no red flags"}`;
  const roles = `🙋 Buyer: <b>${esc(p.telegram?.buyer?.name || "tap below")}</b>   🧑‍🎨 Seller: <b>${esc(p.telegram?.seller?.name || "tap below")}</b>`;
  return `📜 <b>Pact drafted: ${esc(p.title)}</b>\n${esc(p.buyer || "Buyer")} → ${esc(p.seller || "Seller")} · <b>${fmt(p.amount, p.currency)}</b>\n\n${ms}\n\n${risk}\n\n${roles}\n\n` +
    `💡 Paying puts the money on <b>hold</b> in PayPal. It moves to the seller only when the AI confirms the work matches the criteria above.`;
}

function cardButtons(p) {
  return [
    [btn("🙋 I'm the buyer", `rb:${p.id}`), btn("🧑‍🎨 I'm the seller", `rs:${p.id}`)],
    p.status === "draft" ? [link(`💳 Fund ${fmt(p.amount, p.currency)} with PayPal`, `${appUrl()}/api/pacts/${p.id}/fund?via=telegram`)] : [],
    [link("📄 Open pact", `${appUrl()}/pact/${p.id}`)],
  ];
}

function verdictMessage(p, i) {
  const m = p.milestones[i];
  const v = m.verdict;
  const checks = (v.checks || []).map((c) => `${c.met ? "✅" : "❌"} ${esc(c.criterion)}\n     <i>${esc(c.reason)}</i>`).join("\n");
  const amount = (m.amount * v.releasePercent) / 100;
  const head = v.flagged
    ? `🚨 <b>Manipulation attempt blocked</b>\nThe submission for “${esc(m.name)}” tried to instruct the AI verifier (${esc(v.injection.reasons[0])}). Auto-release is off; ${esc(party(p, "buyer"))} must review the work personally.\n${v.injection.excerpts?.[0] ? `<code>${esc(v.injection.excerpts[0])}</code>\n` : ""}`
    : `🔍 <b>AI verification: ${esc(m.name)}</b>`;
  const rec = v.flagged ? "" : `\n\n<b>Recommendation: ${v.decision.toUpperCase()} ${v.releasePercent}%</b> (${fmt(amount, p.currency)})\n${esc(v.summary)}`;
  return `${head}\n${checks}${rec}\n\n👉 ${esc(party(p, "buyer"))}, your call. Money stays held until you decide.`;
}

function verdictButtons(p, i) {
  const m = p.milestones[i];
  const v = m.verdict;
  const amt = fmt((m.amount * v.releasePercent) / 100, p.currency);
  return [
    !v.flagged && v.releasePercent > 0 ? [btn(`✅ Release ${v.releasePercent}% (${amt})`, `ap:${p.id}:${i}`)] : [],
    v.releasePercent < 100 || v.flagged ? [btn("🔁 Ask for a fix", `rv:${p.id}:${i}`)] : [],
    [btn("⚖️ Dispute: ask the AI mediator", `dp:${p.id}:${i}`)],
    v.flagged ? [link("👀 Review the work", `${appUrl()}/pact/${p.id}`)] : [],
  ];
}

export async function postPactEvent(p, event, extra = {}) {
  const chat = p.telegram.chatId;
  const i = extra.milestone ?? p.milestones.findIndex(open);
  const m = p.milestones[i];
  const held = heldAmount(p);
  const nextOpen = p.milestones.find(open);
  switch (event) {
    case "funds_held":
      return say(chat,
        `💰 <b>${fmt(p.amount, p.currency)} is now held by PayPal</b>\nAuthorization <code>${esc(p.authorizationId)}</code>. Nothing has been paid out yet.\n\n` +
        `${esc(party(p, "seller"))}, you can start. When “${esc(nextOpen?.name || "the work")}” is ready, send <b>/deliver</b> with a note, links or photos (add <code>tracking: NUMBER</code> for shipped goods).` +
        `${p.agentMayRelease ? "\n\n🤖 The buyer allowed AI agents to release milestones the verifier fully approves." : ""}`,
        [[btn("↩️ Cancel & refund buyer", `cx:${p.id}`)]]);
    case "delivery_verified":
      return say(chat, verdictMessage(p, i), verdictButtons(p, i));
    case "funds_captured":
    case "funds_returned": {
      const cap = m?.captureIds?.at(-1);
      const tracking = m?.trackingRegistered ? `\n📦 Tracking ${esc(m.submission.trackingNumber)} registered on the PayPal transaction.` : "";
      const rest = nextOpen ? `\n${fmt(held, p.currency)} still held for “${esc(nextOpen.name)}”.` : "";
      return say(chat, event === "funds_captured"
        ? `💸 <b>${fmt(m.releasedAmount, p.currency)} released to ${esc(party(p, "seller"))}</b>${m.releasedAmount < m.amount ? ` (${fmt(m.amount - m.releasedAmount, p.currency)} back to ${esc(party(p, "buyer"))})` : ""}\nPayPal capture <code>${esc(cap || "")}</code>${tracking}${rest}`
        : `↩️ <b>“${esc(m.name)}”: nothing released</b>, ${fmt(m.amount, p.currency)} goes back to ${esc(party(p, "buyer"))}.${rest}`);
    }
    case "pact_closed":
      return say(chat, `🏁 <b>Pact complete: ${esc(p.title)}</b>\n${fmt(p.released, p.currency)} paid to ${esc(party(p, "seller"))}, ${fmt(p.amount - p.released, p.currency)} returned to ${esc(party(p, "buyer"))}. Every step is in the audit trail.`,
        [[link("📄 Audit trail", `${appUrl()}/pact/${p.id}`)]]);
    case "revision_requested":
      return say(chat, `🔁 <b>${esc(party(p, "buyer"))} asked for a fix on “${esc(m.name)}”</b>\nWhat to fix: ${esc(m.history?.at(-1)?.verdict?.summary || "see the checks above")}\nThe money stays held. ${esc(party(p, "seller"))}, resubmit with /deliver.`);
    case "mediation_proposed":
      return say(chat, `⚖️ <b>Mediator proposal: ${m.dispute.sellerPercent}% to ${esc(party(p, "seller"))}</b> (${fmt((m.amount * m.dispute.sellerPercent) / 100, p.currency)}), the rest back to ${esc(party(p, "buyer"))}.\n<i>${esc(m.dispute.reasoning)}</i>\n\nIt settles through PayPal once <b>both</b> of you accept.`,
        [[btn("✅ Buyer accepts", `mb:${p.id}:${i}`), btn("✅ Seller accepts", `ms:${p.id}:${i}`)]]);
    case "mediation_accepted": {
      const acc = m.dispute.accepted || {};
      return say(chat, `👍 ${acc.buyer ? esc(party(p, "buyer")) : esc(party(p, "seller"))} accepted. Waiting for ${acc.buyer ? esc(party(p, "seller")) : esc(party(p, "buyer"))}.`);
    }
    case "hold_voided":
      return say(chat, `↩️ <b>Pact cancelled.</b> The PayPal hold was voided; the buyer's money is released back to them.`);
    case "deadline_enforced":
      return say(chat, `⏰ <b>Deadline missed: “${esc(m?.name || "milestone")}”</b>\nNothing was delivered in time, so the agent <b>voided the PayPal authorization</b> on its own. ${esc(party(p, "buyer"))}'s money is back with them.`);
    case "deadline_reminder":
      return say(chat, `⏰ Heads up ${esc(party(p, "seller"))}: “${esc(nextOpen?.name)}” is due <b>${nextOpen?.deadline}</b>. If it isn't delivered, the hold is voided and ${esc(party(p, "buyer"))} is refunded automatically.`);
    case "hold_renewed":
      return say(chat, `🔄 PayPal's 3-day honor period ended, so the agent <b>reauthorized the hold</b> (${fmt(held, p.currency)}). New authorization <code>${esc(p.authorizationId)}</code>. Protection continues.`);
    case "renew_failed":
      return say(chat, `⚠️ The agent couldn't renew the PayPal hold. ${esc(party(p, "buyer"))}, please check the pact.`, [[link("📄 Open pact", `${appUrl()}/pact/${p.id}`)]]);
    default:
      return null;
  }
}

// ---------- chat memory ----------

const BUF = (chat) => `tg:buf:${chat}`;
async function remember(msg, text) {
  const buf = (await kv.get(BUF(msg.chat.id))) || [];
  const who = msg.forward_origin?.sender_user ? nameOf(msg.forward_origin.sender_user)
    : msg.forward_origin?.sender_user_name || msg.forward_sender_name || nameOf(msg.from);
  buf.push({ who, text: text.slice(0, 1000), at: msg.date });
  await kv.set(BUF(msg.chat.id), buf.slice(-40), 2 * 86400);
  return buf;
}
const transcript = (buf) => buf.map((b) => `${b.who}: ${b.text}`).join("\n");

async function chatPacts(chatId) {
  const ids = (await kv.get(`tg:pacts:${chatId}`)) || [];
  return (await Promise.all(ids.map((id) => store.get(id)))).filter(Boolean);
}
async function addChatPact(chatId, id) {
  const ids = (await kv.get(`tg:pacts:${chatId}`)) || [];
  await kv.set(`tg:pacts:${chatId}`, [...ids.filter((x) => x !== id), id].slice(-20), 60 * 86400);
}

const MONEY = /(\$|usd|₹|rs\.?|inr|€|eur|£|gbp|bucks|dollars|rupees)\s?\d|\d+\s?(\$|usd|₹|rs|inr|€|eur|bucks|dollars|rupees|k\b)/i;
const AGREED = /\b(deal|done|agreed|confirm(ed)?|let'?s do it|sounds good|go ahead|pakka|chalo|works for me|ok(ay)? then)\b|👍|🤝/i;

// The agent notices a deal being agreed and offers to protect it (at most once an hour per chat).
async function maybeSuggest(msg, buf) {
  if (!AGREED.test(msg.text || "")) return;
  const recent = buf.slice(-15);
  if (recent.length < 3 || !recent.some((b) => MONEY.test(b.text))) return;
  if (!(await kv.claim(`tg:suggest:${msg.chat.id}`, 3600))) return;
  await say(msg.chat.id,
    `🤝 Sounds like you just agreed a deal. Want me to protect it?\nI'll turn this chat into a pact, PayPal holds the money, and it's released only when the work matches what you agreed.`,
    [[btn("🛡️ Protect this deal", `dr:${msg.chat.id}`)]]);
}

// ---------- actions from chat ----------

async function draftFromChat(chatId, extraText, from) {
  const buf = (await kv.get(BUF(chatId))) || [];
  const chat = [transcript(buf), extraText].filter(Boolean).join("\n").trim();
  if (chat.length < 20) {
    return say(chatId, `I need the deal conversation first. Either chat here normally and send /pact once you agree, forward me the messages, or send <code>/pact</code> followed by the pasted chat.`);
  }
  await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  const p = await createPact({ chat, source: isPlayground(String(chatId)) ? "playground" : "telegram", telegram: { chatId, startedBy: { id: from.id, name: nameOf(from) } } });
  await addChatPact(chatId, p.id);
  const sent = await say(chatId, pactCard(p), cardButtons(p));
  await store.update(p.id, (x) => { x.telegram.cardMessageId = sent?.message_id; });
}

function parseDelivery(text = "") {
  const links = [...text.matchAll(/https?:\/\/\S+/g)].map((x) => x[0]);
  const t = text.match(/tracking[:#\s]+([A-Z0-9-]{6,34})(?:\s*\(?\s*(ups|fedex|usps|dhl|bluedart|blue dart|delhivery|india post|dtdc|royal mail|canada post)\)?)?/i);
  return { note: text.trim(), links, trackingNumber: t?.[1] || "", carrier: t?.[2] || "" };
}

async function photoDataUrl(fileId) {
  if (fileId.startsWith("pgf_")) return loadImage(fileId);
  const f = await tg("getFile", { file_id: fileId });
  const r = await fetch(`${FILE_API()}/${f.file_path}`);
  const b = Buffer.from(await r.arrayBuffer());
  return `data:image/jpeg;base64,${b.toString("base64")}`;
}

async function deliver(msg, text) {
  const chatId = msg.chat.id;
  const pacts = (await chatPacts(chatId)).filter((p) => p.status === "funded").reverse();
  const p = pacts.find((x) => {
    const m = x.milestones.find(open);
    return m?.status === "pending" && (!x.telegram?.seller || x.telegram.seller.id === msg.from.id);
  });
  if (!p) {
    const mine = pacts.find((x) => x.telegram?.buyer?.id === msg.from.id);
    return say(chatId, mine ? `Only the seller can deliver on “${esc(mine.title)}”.` : `There's no funded pact here waiting for your delivery. Once the buyer funds a pact, send /deliver with your work.`);
  }
  if (p.telegram?.buyer?.id === msg.from.id) return say(chatId, `You're the buyer on “${esc(p.title)}”, so you can't deliver it.`);
  if (!p.telegram.seller) await store.update(p.id, (x) => { x.telegram.seller = { id: msg.from.id, name: nameOf(msg.from) }; });

  const mediaKey = `tg:media:${chatId}:${msg.from.id}`;
  const fileIds = [...((await kv.get(mediaKey)) || [])];
  if (msg.photo) fileIds.push(msg.photo.at(-1).file_id);
  await kv.set(mediaKey, [], 60);
  const sub = parseDelivery(text);
  if (!sub.note && !fileIds.length) return say(chatId, `Send <b>/deliver</b> with a note, links or photos of the work, e.g.\n<code>/deliver 3 concepts attached https://drive.google.com/…</code>`);
  await say(chatId, `🔍 Got it, ${esc(nameOf(msg.from))}. The AI is checking “${esc(p.milestones.find(open).name)}” against every criterion…`);
  await tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  const images = await Promise.all(fileIds.slice(-4).map(photoDataUrl));
  await runAction(p.id, "submit", { ...sub, images }, { via: "telegram", actor: nameOf(msg.from) });
}

async function status(chatId) {
  const pacts = (await Promise.all((await chatPacts(chatId)).map(tick))).reverse();
  if (!pacts.length) return say(chatId, `No pacts in this chat yet. Agree a deal and send /pact.`);
  const lines = pacts.slice(0, 8).map((p) =>
    `• <b>${esc(p.title)}</b>: ${fmt(heldAmount(p), p.currency)} held, ${fmt(p.released, p.currency)} released\n   <i>${esc(nextAction(p))}</i>`);
  return say(chatId, `📊 <b>Pacts in this chat</b>\n${lines.join("\n")}`, [[link("📈 Open the ledger", `${appUrl()}/dashboard`)]]);
}

const HELP = `🛡️ <b>Pactly: escrow for deals made in chats</b>
Add me to the chat where you agree a deal (or forward me the messages).

<b>/pact</b> turn the conversation into a pact (or <code>/pact</code> + pasted chat)
<b>/deliver</b> seller submits work: note, links, photos, <code>tracking: NUMBER</code>
<b>/status</b> what's held, released, and waiting

The buyer pays with PayPal and the money is <b>held</b>, not paid. The AI checks the delivery against the agreed criteria, and only the buyer's tap (or the agent, for missed deadlines) moves the money.`;

// ---------- buttons ----------

async function onButton(q) {
  const [code, id, mi] = (q.data || "").split(":");
  const chatId = q.message?.chat?.id;
  const answer = (text, alert = false) => tg("answerCallbackQuery", { callback_query_id: q.id, text, show_alert: alert }).catch(() => {});
  const user = { id: q.from.id, name: nameOf(q.from) };

  if (code === "dr") { await answer("Drafting the pact…"); return draftFromChat(chatId, "", q.from); }

  const p = await store.get(id);
  if (!p) return answer("That pact no longer exists.", true);
  const t = p.telegram || {};
  const is = (role) => t[role]?.id === q.from.id;

  if (code === "rb" || code === "rs") {
    const role = code === "rb" ? "buyer" : "seller";
    const other = role === "buyer" ? "seller" : "buyer";
    if (is(other)) return answer(`You're already the ${other} on this pact.`, true);
    if (t[role] && !is(role)) return answer(`${t[role].name} is already the ${role}.`, true);
    const np = await store.update(id, (x) => { x.telegram[role] = user; });
    await answer(`You're the ${role} on “${p.title}”.`);
    if (np.telegram.cardMessageId) {
      await tg("editMessageText", { chat_id: chatId, message_id: np.telegram.cardMessageId, text: pactCard(np), parse_mode: "HTML",
        disable_web_page_preview: true, reply_markup: { inline_keyboard: cardButtons(np).filter((r) => r.length) } }).catch(() => {});
    }
    return;
  }

  const buyerOnly = ["ap", "rv", "cx", "mb"].includes(code);
  if (buyerOnly && !t.buyer) return answer(`Tap “I'm the buyer” on the pact card first, so only the buyer can move money.`, true);
  if (buyerOnly && !is("buyer")) return answer(`Only ${t.buyer.name} (the buyer) can do that.`, true);
  if (code === "ms" && !is("seller")) return answer(t.seller ? `Only ${t.seller.name} (the seller) can accept for the seller.` : `The seller needs to claim their role first.`, true);
  if (code === "dp" && !is("buyer") && !is("seller")) return answer("Only the buyer or seller can open a dispute.", true);

  const run = async (action, body, wait) => {
    await answer(wait);
    await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    await runAction(id, action, { milestone: mi != null ? Number(mi) : undefined, ...body }, { via: "telegram", actor: user.name });
  };
  switch (code) {
    case "ap": return run("approve", {}, "Capturing through PayPal…");
    case "rv": return run("revise", {}, "Sending it back to the seller…");
    case "cx": return run("cancel", { actor: user.name, reason: `Cancelled by ${user.name} in Telegram` }, "Voiding the PayPal hold…");
    case "dp": return run("dispute", { [is("buyer") ? "buyerSays" : "sellerSays"]: `${user.name} disputed the verdict in Telegram` }, "The mediator is reviewing…");
    case "mb": case "ms": {
      await answer("Accepted.");
      return runAction(id, "accept-mediation", { milestone: Number(mi), side: code === "mb" ? "buyer" : "seller" }, { via: "telegram", actor: user.name });
    }
    default: return answer("Unknown button.");
  }
}

// ---------- entry point ----------

export async function handleUpdate(u) {
  if (u.callback_query) {
    try { await onButton(u.callback_query); }
    catch (e) { await say(u.callback_query.message.chat.id, `⚠️ ${esc(e instanceof ActionError ? e.message : `Something went wrong: ${e.message}`)}`); }
    return;
  }
  const msg = u.message || u.edited_message;
  if (!msg || msg.from?.is_bot) return;
  const text = msg.text ?? msg.caption ?? "";
  const cmd = text.match(/^\/(\w+)(@\w+)?\s*([\s\S]*)$/);
  try {
    if (cmd) {
      const [, name, , rest] = cmd;
      if (name === "start" || name === "help") return say(msg.chat.id, HELP);
      if (name === "pact" || name === "protect") return draftFromChat(msg.chat.id, [msg.reply_to_message?.text, rest].filter(Boolean).join("\n"), msg.from);
      if (name === "deliver") return deliver(msg, rest);
      if (name === "status") return status(msg.chat.id);
      return;
    }
    if (msg.photo) {
      const key = `tg:media:${msg.chat.id}:${msg.from.id}`;
      await kv.set(key, [...((await kv.get(key)) || []), msg.photo.at(-1).file_id].slice(-6), 900);
    }
    if (text) {
      const buf = await remember(msg, text);
      if (msg.chat.type === "private" && text.length > 120 && MONEY.test(text) && !msg.forward_origin) {
        return say(msg.chat.id, `Is this a deal you'd like to protect?`, [[btn("🛡️ Draft a pact from this", `dr:${msg.chat.id}`)]]);
      }
      await maybeSuggest(msg, buf);
    }
  } catch (e) {
    await say(msg.chat.id, `⚠️ ${esc(e instanceof ActionError ? e.message : `Something went wrong: ${e.message}`)}`).catch(() => {});
  }
}

export async function setupBot(origin) {
  const url = `${origin}/api/telegram`;
  await tg("setWebhook", {
    url, secret_token: process.env.TELEGRAM_WEBHOOK_SECRET || undefined,
    allowed_updates: ["message", "edited_message", "callback_query"], drop_pending_updates: true,
  });
  await tg("setMyCommands", {
    commands: [
      { command: "pact", description: "Turn this chat's deal into a PayPal-backed pact" },
      { command: "deliver", description: "Seller: submit work (note, links, photos, tracking)" },
      { command: "status", description: "What's held, released and waiting" },
      { command: "help", description: "How Pactly works" },
    ],
  });
  await tg("setMyDescription", { description: "Escrow for deals made in chats. I turn your conversation into a pact, PayPal holds the money, and AI checks the work before anything is released." }).catch(() => {});
  const me = await tg("getMe", {});
  return { webhook: url, bot: `@${me.username}` };
}
