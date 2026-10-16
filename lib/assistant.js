// Pactly chat agent: answers questions about deals and drafts pacts on its own,
// but every money-moving action is returned as a PROPOSAL the human must confirm.
import { geminiTurn, extractPact } from "@/lib/ai";
import { store, heldAmount, log } from "@/lib/store";

const SYSTEM = `You are Pactly's escrow agent. You help buyers and sellers manage escrow "pacts" backed by PayPal holds (authorizations).
- Always use tools to look up real data; never invent pact IDs, amounts or statuses.
- Refer to pacts by title and people by name; keep answers short and concrete, with amounts and currency.
- You may draft new pacts directly from a pasted chat with draft_pact.
- You can NEVER move money yourself. To release, refund, cancel or request a revision, call the matching propose_* tool;
  the user will see a Confirm button. Tell them what you proposed and why.
- Demo pacts (id starts with "demo-") are read-only: explain them but don't propose actions on them.
- If a request is ambiguous (several matching pacts), ask which one.
- Format: short markdown (bold, bullet lists). When you mention a pact, put its id in backticks once, e.g. \`26803e57\`, so it becomes a link. Keep replies under ~120 words.`;

const summary = (p) => ({
  id: p.id, title: p.title, buyer: p.buyer, seller: p.seller, status: p.status, currency: p.currency,
  amount: p.amount, held: heldAmount(p), released: p.released || 0, riskScore: p.riskScore, demo: !!p.demo,
  milestones: p.milestones.map((m, i) => ({
    index: i, name: m.name, amount: m.amount, status: m.status, deadline: m.deadline || null,
    verdict: m.verdict ? { decision: m.verdict.decision, releasePercent: m.verdict.releasePercent, summary: m.verdict.summary } : null,
  })),
});

const S = (type, description, extra = {}) => ({ type, description, ...extra });
const TOOLS = [
  { name: "list_pacts", description: "List all pacts with status, held and released amounts.", parameters: { type: "object", properties: {} } },
  { name: "get_pact", description: "Full details of one pact including milestones, AI verdicts, risk flags and recent audit events.",
    parameters: { type: "object", properties: { pactId: S("string", "Pact id") }, required: ["pactId"] } },
  { name: "draft_pact", description: "Create a new draft pact from a pasted buyer/seller chat.",
    parameters: { type: "object", properties: { chat: S("string", "The full chat text") }, required: ["chat"] } },
  { name: "propose_release", description: "Propose capturing a percentage of a verified milestone to the seller via PayPal.",
    parameters: { type: "object", properties: { pactId: S("string", "Pact id"), milestone: S("integer", "Milestone index"), percent: S("number", "0-100"), reason: S("string", "Why") }, required: ["pactId", "milestone", "percent", "reason"] } },
  { name: "propose_revision", description: "Propose sending a verified milestone back to the seller to fix and resubmit (money stays held).",
    parameters: { type: "object", properties: { pactId: S("string", "Pact id"), milestone: S("integer", "Milestone index"), reason: S("string", "Why") }, required: ["pactId", "milestone", "reason"] } },
  { name: "propose_cancel", description: "Propose cancelling a pact and voiding the remaining PayPal hold back to the buyer.",
    parameters: { type: "object", properties: { pactId: S("string", "Pact id"), reason: S("string", "Why") }, required: ["pactId", "reason"] } },
];

async function runTool(name, args, proposals) {
  switch (name) {
    case "list_pacts": return { pacts: (await store.all()).map(summary) };
    case "get_pact": {
      const p = await store.get(args.pactId);
      if (!p) return { error: "No pact with that id" };
      return { ...summary(p), summary: p.summary, riskFlags: p.riskFlags, audit: (p.audit || []).slice(-6) };
    }
    case "draft_pact": {
      const ai = await extractPact(args.chat);
      const ms = (ai.milestones?.length ? ai.milestones : [{ name: "Full delivery", amount: ai.amount, criteria: [ai.summary] }]);
      const pact = {
        id: crypto.randomUUID().slice(0, 8), ...ai, currency: (ai.currency || "USD").toUpperCase(),
        milestones: ms.map((m) => ({ ...m, status: "pending" })), chat: args.chat, status: "draft", released: 0,
        createdAt: new Date().toISOString(),
      };
      log(pact, "agent", "pact_drafted", `Drafted from chat by the assistant; risk ${ai.riskScore}/100`);
      await store.put(pact);
      return { created: summary(pact), link: `/pact/${pact.id}`, riskFlags: ai.riskFlags };
    }
    case "propose_release": case "propose_revision": case "propose_cancel": {
      const p = await store.get(args.pactId);
      if (!p) return { error: "No pact with that id" };
      if (p.demo) return { error: "Demo pacts are read-only" };
      const m = args.milestone != null ? p.milestones[args.milestone] : null;
      if (name !== "propose_cancel" && (!m || m.status !== "verified")) return { error: "That milestone is not awaiting a decision (it must be delivered and verified first)" };
      if (name === "propose_cancel" && heldAmount(p) <= 0) return { error: "Nothing is held on this pact" };
      const prop = {
        pactId: p.id, title: p.title, reason: args.reason,
        ...(name === "propose_release" && { action: "approve", body: { milestone: args.milestone, percent: args.percent },
          label: `Release ${args.percent}% of “${m.name}” (${(m.amount * args.percent / 100).toFixed(2)} ${p.currency}) to ${p.seller || "seller"}` }),
        ...(name === "propose_revision" && { action: "revise", body: { milestone: args.milestone }, label: `Send “${m.name}” back to ${p.seller || "seller"} for revision` }),
        ...(name === "propose_cancel" && { action: "cancel", body: { actor: "buyer", reason: `Cancelled via agent: ${args.reason}` },
          label: `Cancel “${p.title}” and return ${heldAmount(p).toFixed(2)} ${p.currency} to ${p.buyer || "buyer"}` }),
      };
      proposals.push(prop);
      return { proposed: prop.label, note: "Awaiting the user's confirmation; nothing has moved yet." };
    }
    default: return { error: "Unknown tool" };
  }
}

// messages: [{ role: "user"|"assistant", text }]
export async function chat(messages) {
  const contents = messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] }));
  const proposals = [];
  const steps = [];
  for (let i = 0; i < 6; i++) {
    const reply = await geminiTurn(SYSTEM, contents, TOOLS);
    contents.push(reply);
    const calls = (reply.parts || []).filter((p) => p.functionCall);
    if (!calls.length) {
      const text = (reply.parts || []).map((p) => p.text || "").join("").trim();
      return { text: text || "Done.", proposals, steps };
    }
    const responses = [];
    for (const { functionCall } of calls) {
      steps.push(functionCall.name);
      let result;
      try { result = await runTool(functionCall.name, functionCall.args || {}, proposals); }
      catch (e) { result = { error: e.message }; }
      responses.push({ functionResponse: { name: functionCall.name, response: result } });
    }
    contents.push({ role: "user", parts: responses });
  }
  return { text: "I ran out of steps; please try a more specific question.", proposals, steps };
}
