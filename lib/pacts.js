// Creating pacts and describing them. Shared by the web app, the Telegram bot, the chat agent and the MCP server.
import { extractPact } from "@/lib/ai";
import { store, log, heldAmount, returnedAmount, nextAction } from "@/lib/store";

export const appUrl = () =>
  (process.env.APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) ||
    (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`) ||
    "http://localhost:3000").replace(/\/$/, "");

export const fmt = (n, c = "USD") => `${c === "USD" ? "$" : `${c} `}${Number(n || 0).toFixed(2)}`;

// Milestone amounts must always add up to the total the buyer authorizes.
function normalise(ms, total) {
  const list = ms?.length ? ms : [{ name: "Full delivery", amount: total, criteria: ["Work delivered as agreed in the chat"] }];
  const sum = list.reduce((s, m) => s + Number(m.amount || 0), 0);
  const scaled = Math.abs(sum - total) > 0.01 && sum > 0
    ? list.map((m) => ({ ...m, amount: +((Number(m.amount) / sum) * total).toFixed(2) }))
    : list.map((m) => ({ ...m, amount: +Number(m.amount).toFixed(2) }));
  const drift = +(total - scaled.reduce((s, m) => s + m.amount, 0)).toFixed(2);
  if (drift) scaled[scaled.length - 1].amount = +(scaled.at(-1).amount + drift).toFixed(2);
  return scaled.map((m) => ({
    name: m.name, amount: m.amount, deadline: m.deadline || "",
    criteria: (m.criteria || []).filter(Boolean).length ? m.criteria.filter(Boolean) : ["Delivered as described"],
    status: "pending",
  }));
}

// Party names come from a model: keep only a clean, short name ("Arjun fatigue score: 0," -> "Arjun").
export function cleanName(v) {
  const t = String(v || "").split(/[\n,:;|(\[{]/)[0].replace(/\s+/g, " ").trim();
  const words = t.split(" ").filter(Boolean);
  const cut = words.findIndex((w, i) => i > 0 && /^(score|risk|fatigue|buyer|seller|role|amount|\d+)$/i.test(w));
  return (cut > 0 ? words.slice(0, cut) : words).slice(0, 4).join(" ").slice(0, 40);
}

// From a chat (AI extraction) or from a structured spec written by another AI agent (MCP).
export async function createPact({ chat, spec, sellerEmail = "", source = "web", telegram, createdBy } = {}) {
  let base, detail;
  if (spec) {
    const amount = +Number(spec.amount).toFixed(2);
    if (!(amount > 0)) throw new Error("amount must be a positive number");
    base = {
      title: spec.title, buyer: spec.buyer || "", seller: spec.seller || "", amount,
      currency: (spec.currency || "USD").toUpperCase(), deadline: spec.deadline || "",
      summary: spec.summary || spec.title, riskFlags: [], riskScore: 0, milestones: spec.milestones,
    };
    detail = `Created from a structured spec by ${createdBy || "an AI agent"} (${base.milestones?.length || 1} milestone(s))`;
  } else {
    if (!chat || chat.trim().length < 20) throw new Error("Paste the deal chat first.");
    base = await extractPact(chat);
    base.amount = +Number(base.amount).toFixed(2);
    detail = `Extracted ${base.milestones?.length || 1} milestone(s) from the chat, risk ${base.riskScore}/100`;
  }
  base.buyer = cleanName(base.buyer);
  base.seller = cleanName(base.seller);
  base.title = String(base.title || "Deal").replace(/\s+/g, " ").trim().slice(0, 90);
  const pact = {
    id: crypto.randomUUID().slice(0, 8),
    ...base,
    currency: (base.currency || "USD").toUpperCase(),
    milestones: normalise(base.milestones, base.amount),
    sellerEmail: sellerEmail || spec?.sellerEmail || "",
    chat: chat || "",
    status: "draft",
    released: 0,
    source,
    ...(createdBy ? { createdBy } : {}),
    ...(telegram ? { telegram } : {}),
    createdAt: new Date().toISOString(),
  };
  log(pact, "agent", "pact_drafted", detail);
  await store.put(pact);
  return pact;
}

// Compact, agent-friendly view of a pact (used by the chat agent, MCP and the bot).
export function describe(p) {
  return {
    id: p.id, title: p.title, buyer: p.buyer, seller: p.seller, status: p.status, nextAction: nextAction(p),
    currency: p.currency, amount: p.amount, held: heldAmount(p), released: p.released || 0, returned: returnedAmount(p),
    riskScore: p.riskScore, riskFlags: p.riskFlags || [], source: p.source || "web", demo: !!p.demo,
    agentMayRelease: !!p.agentMayRelease,
    paypal: { orderId: p.orderId || null, authorizationId: p.authorizationId || null, honorEndsAt: p.honorEndsAt || null, authExpiresAt: p.authExpiresAt || null },
    links: {
      pact: `${appUrl()}/pact/${p.id}`,
      // agent-created pacts are funded on the pact page, where the human also decides the agent's release mandate
      fund: p.status !== "draft" ? null : p.source === "mcp" ? `${appUrl()}/pact/${p.id}?role=buyer` : `${appUrl()}/api/pacts/${p.id}/fund`,
    },
    milestones: p.milestones.map((m, i) => ({
      index: i, name: m.name, amount: m.amount, status: m.status, deadline: m.deadline || null, criteria: m.criteria,
      captureIds: m.captureIds || [],
      verdict: m.verdict ? {
        decision: m.verdict.decision, releasePercent: m.verdict.releasePercent, summary: m.verdict.summary,
        flagged: !!m.verdict.flagged, checks: m.verdict.checks?.map((c) => ({ criterion: c.criterion, met: c.met })),
      } : null,
    })),
  };
}
