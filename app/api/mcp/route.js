// Pactly as a remote MCP server (Streamable HTTP, JSON responses).
// Any MCP client (Claude, ChatGPT connectors, Cursor, agent frameworks) can open a PayPal-backed escrow pact,
// relay a delivery for AI verification, and settle it. Money rules are enforced server-side in lib/actions.js:
//  - funding always needs a human approving in PayPal;
//  - an agent may release money only if the buyer granted that mandate when funding, never above the verifier's
//    certified percentage, and never on a delivery flagged as a manipulation attempt;
//  - returning money to the buyer (cancel) is always allowed.
import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import { createPact, describe } from "@/lib/pacts";
import { runAction, tick } from "@/lib/actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
};

const str = (description) => ({ type: "string", description });
const num = (description) => ({ type: "number", description });
const pactId = { pactId: str("Pact id, e.g. 3f9a2c1d") };

const TOOLS = [
  {
    name: "create_escrow_pact",
    title: "Create an escrow pact",
    description: "Open a PayPal-backed escrow pact for a deal with a human or another agent. Pass either `chat` (a raw buyer/seller conversation; Pactly's AI extracts parties, milestones, checkable acceptance criteria and scam risk) or a structured spec (title, amount, milestones with criteria). Returns the pact and a funding link: send `links.fund` to the human who pays. Money is only held (PayPal authorization) until delivery is verified.",
    inputSchema: {
      type: "object",
      properties: {
        chat: str("Raw conversation in which the deal was agreed (any language). Use this OR the structured fields."),
        title: str("Short deal title"),
        amount: num("Total amount"),
        currency: str("ISO currency code, default USD"),
        buyer: str("Buyer name (for example the human you act for)"),
        seller: str("Seller name"),
        sellerEmail: str("Seller's PayPal email; captured funds go here"),
        summary: str("One-paragraph description of the work"),
        milestones: {
          type: "array",
          description: "Stages of the deal; amounts should add up to the total",
          items: {
            type: "object",
            properties: {
              name: str("Milestone name"), amount: num("Amount for this milestone"),
              criteria: { type: "array", items: { type: "string" }, description: "Objectively checkable acceptance criteria" },
              deadline: str("YYYY-MM-DD, optional"),
            },
            required: ["name", "amount", "criteria"],
          },
        },
        agentName: str("Your name as an agent, shown in the audit trail"),
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "list_pacts", title: "List pacts",
    description: "List pacts with status, what each is waiting for, and how much is held, released and returned.",
    inputSchema: { type: "object", properties: { onlyOpen: { type: "boolean", description: "Only pacts that are not finished" } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_pact", title: "Get a pact",
    description: "Full state of one pact: milestones, criteria, AI verdicts (with per-criterion checks), PayPal ids, the agent mandate and the last audit events.",
    inputSchema: { type: "object", properties: pactId, required: ["pactId"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "submit_delivery", title: "Submit a delivery",
    description: "Submit (or relay) the seller's delivery for the current milestone. Pactly's AI verifier checks it against every acceptance criterion and recommends release, partial or hold. Text is screened for prompt injection; manipulation attempts are blocked.",
    inputSchema: {
      type: "object",
      properties: {
        ...pactId, note: str("What was delivered"),
        links: { type: "array", items: { type: "string" }, description: "Links to the work" },
        trackingNumber: str("Shipment tracking number for goods"), carrier: str("Carrier, e.g. UPS, DHL"),
        agentName: str("Your name as an agent"),
      },
      required: ["pactId", "note"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "release_milestone", title: "Release a verified milestone",
    description: "Capture a verified milestone to the seller through PayPal. Allowed for agents only when the buyer granted a release mandate while funding, up to the verifier's certified percentage, and never for flagged deliveries. Otherwise returns a link for the human buyer to decide.",
    inputSchema: {
      type: "object",
      properties: { ...pactId, milestone: { type: "integer", description: "Milestone index (default: current)" }, percent: num("Percent to release (default: verifier's recommendation)"), agentName: str("Your name as an agent") },
      required: ["pactId"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  },
  {
    name: "request_revision", title: "Ask the seller to fix and resubmit",
    description: "Send a verified milestone back to the seller; the money stays held.",
    inputSchema: { type: "object", properties: { ...pactId, milestone: { type: "integer", description: "Milestone index" }, reason: str("What must be fixed") }, required: ["pactId"] },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "open_dispute", title: "Ask the AI mediator",
    description: "Open a dispute on a verified milestone. Pactly's mediator proposes a split, which settles when both parties accept.",
    inputSchema: { type: "object", properties: { ...pactId, milestone: { type: "integer", description: "Milestone index" }, buyerSays: str("Buyer's position"), sellerSays: str("Seller's position") }, required: ["pactId"] },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "cancel_pact", title: "Cancel and refund the buyer",
    description: "Cancel the pact and void the remaining PayPal hold so the buyer is not charged. Already-released milestones are unaffected.",
    inputSchema: { type: "object", properties: { ...pactId, reason: str("Why") }, required: ["pactId", "reason"] },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
];

const withAudit = (p) => ({ ...describe(p), lastEvents: (p.audit || []).slice(-6).map((a) => `${a.at.slice(0, 16)} [${a.actor}] ${a.event}: ${a.detail}`) });

async function callTool(name, a = {}) {
  const ctx = { via: "agent", actor: a.agentName ? `${a.agentName} (MCP)` : "AI agent (MCP)" };
  const need = async () => {
    const p = await store.get(a.pactId);
    if (!p) throw new Error(`No pact with id ${a.pactId}`);
    return p;
  };
  switch (name) {
    case "create_escrow_pact": {
      const spec = a.chat ? undefined : { ...a, milestones: a.milestones };
      if (!a.chat && !(a.title && a.amount)) throw new Error("Pass either `chat`, or at least `title` and `amount`.");
      const p = await createPact({ chat: a.chat, spec, sellerEmail: a.sellerEmail, source: "mcp", createdBy: ctx.actor });
      return {
        pact: describe(p),
        next: `Send this funding link to the person paying: ${describe(p).links.fund} . They approve once in PayPal; the money is held, not paid out. On that page they can also allow you to release milestones the verifier fully approves.`,
      };
    }
    case "list_pacts": {
      const all = await store.all();
      return { pacts: all.filter((p) => !a.onlyOpen || !["settled", "voided"].includes(p.status)).map(describe) };
    }
    case "get_pact": return withAudit(await tick(await need()));
    case "submit_delivery": {
      await need();
      const { pact } = await runAction(a.pactId, "submit", a, ctx);
      return withAudit(pact);
    }
    case "release_milestone": {
      const p = await need();
      try {
        const { pact, amount } = await runAction(a.pactId, "approve", { milestone: a.milestone, percent: a.percent }, ctx);
        return { released: amount, currency: pact.currency, pact: withAudit(pact) };
      } catch (e) {
        if (e.status === 403) return { released: 0, needsHuman: true, reason: e.message, decideAt: describe(p).links.pact };
        throw e;
      }
    }
    case "request_revision": return withAudit((await runAction(a.pactId, "revise", { milestone: a.milestone, reason: a.reason }, ctx)).pact);
    case "open_dispute": return withAudit((await runAction(a.pactId, "dispute", a, ctx)).pact);
    case "cancel_pact": return withAudit((await runAction(a.pactId, "cancel", { actor: ctx.actor, reason: a.reason }, ctx)).pact);
    default: throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  }
}

async function handle(msg) {
  const { id, method, params = {} } = msg;
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const fail = (code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
  if (msg.jsonrpc !== "2.0" || typeof method !== "string") return fail(-32600, "Invalid request");
  if (id === undefined) return null; // notification (e.g. notifications/initialized)
  switch (method) {
    case "initialize":
      return ok({
        protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "pactly", title: "Pactly escrow", version: "1.0.0" },
        instructions: "Pactly is escrow for informal deals, backed by PayPal authorizations. Create a pact, send the funding link to the human who pays, relay deliveries for AI verification, and release only within the buyer's mandate. Never ask anyone to pay outside PayPal.",
      });
    case "ping": return ok({});
    case "tools/list": return ok({ tools: TOOLS });
    case "tools/call": {
      if (!TOOLS.some((t) => t.name === params.name)) return fail(-32602, `Unknown tool: ${params.name}`);
      try {
        const data = await callTool(params.name, params.arguments || {});
        return ok({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data, isError: false });
      } catch (e) {
        return ok({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
      }
    }
    default: return fail(-32601, `Method not found: ${method}`);
  }
}

function authorized(req) {
  const key = process.env.MCP_API_KEY;
  if (!key) return true;
  const url = new URL(req.url);
  return req.headers.get("authorization") === `Bearer ${key}` || url.searchParams.get("key") === key;
}

export async function POST(req) {
  if (!authorized(req)) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }, { status: 401, headers: CORS });
  let body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400, headers: CORS }); }
  const batch = Array.isArray(body);
  const out = (await Promise.all((batch ? body : [body]).map(handle))).filter(Boolean);
  if (!out.length) return new NextResponse(null, { status: 202, headers: CORS });
  return NextResponse.json(batch ? out : out[0], { headers: CORS });
}

export async function GET() {
  return NextResponse.json({ error: "This MCP server uses Streamable HTTP with JSON responses; POST JSON-RPC here." }, { status: 405, headers: { ...CORS, Allow: "POST, OPTIONS" } });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
