// The Pactly agent: three reasoning jobs, each forced into structured JSON via tool use.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.AI_MODEL || "claude-sonnet-5-5";

async function structured(system, content, name, schema) {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system,
    tools: [{ name, description: `Return the ${name} result`, input_schema: schema }],
    tool_choice: { type: "tool", name },
    messages: [{ role: "user", content }],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block) throw new Error("AI returned no structured result");
  return block.input;
}

export async function extractPact(chat) {
  return structured(
    `You turn informal buyer/seller chats (WhatsApp, Instagram, email; any language incl. Hinglish) into a fair, precise escrow contract.
Rules: only use facts in the chat; make acceptance criteria objectively checkable; split into milestones only if the chat implies stages (amounts must sum to total);
flag scam/risk signals (off-platform payment pressure, urgency, too-good prices, identity mismatch). Currency as ISO code (default USD if unclear).`,
    `Chat:\n"""\n${chat}\n"""`,
    "pact",
    {
      type: "object",
      properties: {
        title: { type: "string" },
        buyer: { type: "string" },
        seller: { type: "string" },
        amount: { type: "number" },
        currency: { type: "string" },
        deadline: { type: "string", description: "ISO date or empty" },
        summary: { type: "string" },
        milestones: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              amount: { type: "number" },
              criteria: { type: "array", items: { type: "string" } },
            },
            required: ["name", "amount", "criteria"],
          },
        },
        riskFlags: { type: "array", items: { type: "string" } },
        riskScore: { type: "number", description: "0 (safe) to 100 (likely scam)" },
      },
      required: ["title", "amount", "currency", "summary", "milestones", "riskFlags", "riskScore"],
    }
  );
}

export async function verifyDelivery(pact, milestone, submission) {
  const content = [
    { type: "text", text: `Contract: ${JSON.stringify({ title: pact.title, summary: pact.summary })}
Milestone: ${milestone.name}
Acceptance criteria:\n${milestone.criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}
Seller's note: ${submission.note || "(none)"}
Links: ${(submission.links || []).join(", ") || "(none)"}` },
    ...(submission.images || []).slice(0, 5).map((dataUrl) => {
      const [meta, data] = dataUrl.split(",");
      return { type: "image", source: { type: "base64", media_type: meta.slice(5, meta.indexOf(";")), data } };
    }),
  ];
  return structured(
    `You are an impartial escrow verifier. Check the delivered evidence against EACH acceptance criterion.
Be strict but fair: a criterion is met only if the evidence shows it. Recommend "release" only if all criteria are met,
"partial" if some value was delivered, else "hold". Give a short, plain reason per criterion both parties will read.`,
    content,
    "verdict",
    {
      type: "object",
      properties: {
        checks: {
          type: "array",
          items: {
            type: "object",
            properties: { criterion: { type: "string" }, met: { type: "boolean" }, reason: { type: "string" } },
            required: ["criterion", "met", "reason"],
          },
        },
        decision: { type: "string", enum: ["release", "partial", "hold"] },
        releasePercent: { type: "number", description: "0-100 of this milestone's amount" },
        summary: { type: "string" },
      },
      required: ["checks", "decision", "releasePercent", "summary"],
    }
  );
}

export async function mediate(pact, milestone, verdict, buyerSays, sellerSays) {
  return structured(
    `You are a neutral dispute mediator for small informal deals. Weigh the contract, the verification evidence and both statements.
Propose a split of the held milestone amount that a reasonable person would call fair, and explain it in 2-3 sentences.`,
    `Contract: ${JSON.stringify(pact.summary)}\nMilestone: ${JSON.stringify(milestone)}
Verification: ${JSON.stringify(verdict)}\nBuyer: ${buyerSays}\nSeller: ${sellerSays}`,
    "proposal",
    {
      type: "object",
      properties: {
        sellerPercent: { type: "number" },
        reasoning: { type: "string" },
      },
      required: ["sellerPercent", "reasoning"],
    }
  );
}
