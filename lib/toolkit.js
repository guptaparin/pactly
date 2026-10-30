// PayPal Agent Toolkit (@paypal/agent-toolkit) wired into Pactly's agents.
// - Read-only PayPal tools (orders, transactions, disputes, shipment tracking) are exposed to the chat agent
//   so it can check PayPal's own records instead of trusting the local ledger.
// - Shipment tracking is registered on PayPal for goods deals once a milestone is captured.
// Money-moving toolkit tools (refunds, order capture) are deliberately NOT enabled: Pactly's guarded
// escrow engine is the only path that moves money.

const READ_ONLY = {
  orders: { get: true },
  shipment: { get: true },
  transactions: { list: true },
  disputes: { list: true, get: true },
};

let cached;
async function toolkit(actions) {
  const { PayPalAgentToolkit } = await import("@paypal/agent-toolkit/openai");
  return new PayPalAgentToolkit({
    clientId: (process.env.PAYPAL_CLIENT_ID || process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || "").trim(),
    clientSecret: (process.env.PAYPAL_CLIENT_SECRET || "").trim(),
    configuration: { actions, context: { sandbox: (process.env.PAYPAL_MODE || "sandbox") !== "live" } },
  });
}

// Convert the toolkit's JSON Schema into the OpenAPI subset Gemini function declarations accept.
function toGeminiSchema(s) {
  if (!s || typeof s !== "object") return s;
  if (s.anyOf) {
    const pick = s.anyOf.find((x) => x.type && x.type !== "null") || s.anyOf.map(toGeminiSchema).find((x) => x?.type);
    return toGeminiSchema({ ...pick, description: s.description || pick?.description });
  }
  const out = {};
  if (s.type) out.type = s.type;
  if (s.description) out.description = s.description.slice(0, 300);
  if (s.enum) out.enum = s.enum.map(String);
  if (s.type === "object") {
    out.properties = Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, toGeminiSchema(v)]).filter(([, v]) => v?.type));
    if (s.required?.length) out.required = s.required.filter((k) => out.properties[k]);
  }
  if (s.type === "array") out.items = toGeminiSchema(s.items) || { type: "string" };
  return out;
}

export async function paypalReadTools() {
  if (!cached) {
    const tk = await toolkit(READ_ONLY);
    cached = {
      tk,
      declarations: tk.getTools().map((t) => ({
        name: `paypal_${t.function.name}`,
        description: `[PayPal Agent Toolkit] ${t.function.description}`.slice(0, 900),
        parameters: toGeminiSchema(t.function.parameters),
      })),
    };
  }
  return cached.declarations;
}

export async function callPaypalReadTool(name, args) {
  await paypalReadTools();
  const res = await cached.tk.handleToolCall({
    id: crypto.randomUUID(), type: "function",
    function: { name: name.replace(/^paypal_/, ""), arguments: JSON.stringify(args || {}) },
  });
  let out;
  try { out = JSON.parse(res.content); } catch { out = { result: String(res.content).slice(0, 4000) }; }
  return out && typeof out === "object" && !Array.isArray(out) ? out : { result: out };
}

// Register a shipment on the PayPal order/capture so the buyer sees tracking in PayPal
// and the seller's sale is covered by tracking-based protection.
export async function addShipmentTracking({ orderId, captureId, trackingNumber, carrier }) {
  const tk = await toolkit({ shipment: { create: true } });
  const res = await tk.handleToolCall({
    id: crypto.randomUUID(), type: "function",
    function: {
      name: "create_shipment_tracking",
      arguments: JSON.stringify({
        order_id: orderId, transaction_id: captureId, tracking_number: trackingNumber,
        carrier: (carrier || "OTHER").toUpperCase().replace(/\s+/g, "_"), status: "SHIPPED",
      }),
    },
  });
  const text = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
  if (/error|invalid|denied/i.test(text) && !/"id"/.test(text)) throw new Error(text.slice(0, 200));
  return text;
}
