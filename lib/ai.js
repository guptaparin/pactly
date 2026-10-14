// The Pactly agent: three reasoning jobs, each forced into structured JSON via tool use.
// Provider-pluggable: Google Gemini (free tier, default) or Anthropic Claude.
const PROVIDER = process.env.AI_PROVIDER || (process.env.GEMINI_API_KEY ? "gemini" : "anthropic");
const MODEL = process.env.AI_MODEL || (PROVIDER === "gemini" ? "gemini-2.5-flash" : "claude-sonnet-5-5");

// content: string or array of {type:"text",text} | {type:"image",source:{media_type,data}}
const parts = (content) => (typeof content === "string" ? [{ type: "text", text: content }] : content);

async function gemini(system, content, schema) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{
          role: "user",
          parts: parts(content).map((p) =>
            p.type === "image" ? { inlineData: { mimeType: p.source.media_type, data: p.source.data } } : { text: p.text }
          ),
        }],
        generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.2 },
      }),
    }
  );
  const d = await r.json();
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${d.error?.message || "request failed"}`);
  const text = d.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("");
  if (!text) throw new Error("AI returned no result");
  return JSON.parse(text);
}

async function claude(system, content, name, schema) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system,
    tools: [{ name, description: `Return the ${name} result`, input_schema: schema }],
    tool_choice: { type: "tool", name },
    messages: [{ role: "user", content: parts(content) }],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block) throw new Error("AI returned no structured result");
  return block.input;
}

async function structured(system, content, name, schema) {
  return PROVIDER === "gemini" ? gemini(system, content, schema) : claude(system, content, name, schema);
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
