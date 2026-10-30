// PayPal REST (sandbox) client: Orders v2 with AUTHORIZE intent = escrow-style hold.
const BASE = process.env.PAYPAL_API_BASE || "https://api-m.sandbox.paypal.com";

const clean = (v) => (v || "").trim().replace(/^["']|["']$/g, "");
export const CLIENT_ID = () => clean(process.env.PAYPAL_CLIENT_ID || process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID);
const SECRET = () => clean(process.env.PAYPAL_CLIENT_SECRET);

export async function token() {
  const auth = Buffer.from(`${CLIENT_ID()}:${SECRET()}`).toString("base64");
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`PayPal auth failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).access_token;
}

async function pp(path, method = "POST", body, extraHeaders = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await token()}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": crypto.randomUUID(), // idempotency
      Prefer: "return=representation",
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : {};
  if (!r.ok) throw new Error(`PayPal ${method} ${path} -> ${r.status}: ${data.message || text}`);
  return data;
}

const money = (v, c) => ({ currency_code: c, value: Number(v).toFixed(2) });

export const paypal = {
  createHoldOrder: (pact) =>
    pp("/v2/checkout/orders", "POST", {
      intent: "AUTHORIZE",
      purchase_units: [{
        reference_id: pact.id,
        description: `Pactly escrow: ${pact.title}`.slice(0, 127),
        amount: money(pact.amount, pact.currency),
        ...(pact.sellerEmail ? { payee: { email_address: pact.sellerEmail } } : {}),
      }],
    }),
  // Same hold, but funded through a PayPal-hosted approval page (used by Telegram and agent links,
  // where there is no web page to render the JS SDK button). PayPal redirects back to returnUrl.
  createHoldOrderRedirect: (pact, returnUrl, cancelUrl) =>
    pp("/v2/checkout/orders", "POST", {
      intent: "AUTHORIZE",
      purchase_units: [{
        reference_id: pact.id,
        description: `Pactly escrow: ${pact.title}`.slice(0, 127),
        amount: money(pact.amount, pact.currency),
        ...(pact.sellerEmail ? { payee: { email_address: pact.sellerEmail } } : {}),
      }],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Pactly escrow",
            shipping_preference: "NO_SHIPPING",
            user_action: "CONTINUE",
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
        },
      },
    }),
  authorizeOrder: (orderId) => pp(`/v2/checkout/orders/${orderId}/authorize`, "POST", {}),
  // After PayPal's 3-day honor period, an authorization can be reauthorized once to renew the hold.
  reauthorize: (authId, amount, currency) =>
    pp(`/v2/payments/authorizations/${authId}/reauthorize`, "POST", { amount: money(amount, currency) }),
  capture: (authId, amount, currency, final) =>
    pp(`/v2/payments/authorizations/${authId}/capture`, "POST", {
      amount: money(amount, currency),
      final_capture: final,
    }),
  void: (authId) => pp(`/v2/payments/authorizations/${authId}/void`, "POST"),
  verifyWebhook: (headers, event) =>
    pp("/v1/notifications/verify-webhook-signature", "POST", {
      auth_algo: headers.get("paypal-auth-algo"),
      cert_url: headers.get("paypal-cert-url"),
      transmission_id: headers.get("paypal-transmission-id"),
      transmission_sig: headers.get("paypal-transmission-sig"),
      transmission_time: headers.get("paypal-transmission-time"),
      webhook_id: process.env.PAYPAL_WEBHOOK_ID,
      webhook_event: event,
    }),
};
