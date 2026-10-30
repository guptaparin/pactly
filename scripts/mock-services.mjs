// Offline stand-ins for the PayPal REST API and the Telegram Bot API, used by scripts/e2e.mjs.
// They record every call so the test can assert exactly which money movements happened.
import http from "node:http";

export function startMocks(port) {
  const calls = [];
  const orders = {};
  let n = 0;
  const id = (p) => `${p}${String(++n).padStart(17, "0")}`;
  const base = `http://localhost:${port}`;

  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const body = raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : {};
    const url = new URL(req.url, base);
    const send = (status, data) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(data === undefined ? "" : JSON.stringify(data)); };
    calls.push({ method: req.method, path: url.pathname, body });

    // ---- Telegram ----
    const tgm = url.pathname.match(/^\/bot[^/]+\/(\w+)$/);
    if (tgm) {
      const m = tgm[1];
      if (m === "sendMessage") return send(200, { ok: true, result: { message_id: ++n, chat: { id: body.chat_id }, text: body.text } });
      if (m === "getMe") return send(200, { ok: true, result: { id: 1, username: "pactly_test_bot" } });
      return send(200, { ok: true, result: true });
    }

    // ---- PayPal ----
    const p = url.pathname;
    if (p === "/v1/oauth2/token") return send(200, { access_token: "A21-mock", expires_in: 3600 });
    if (p === "/v2/checkout/orders" && req.method === "POST") {
      const oid = id("ORD");
      orders[oid] = body;
      return send(201, { id: oid, status: body.payment_source ? "PAYER_ACTION_REQUIRED" : "CREATED",
        links: [{ rel: body.payment_source ? "payer-action" : "approve", href: `${base}/checkoutnow?token=${oid}` }] });
    }
    let m;
    if ((m = p.match(/^\/v2\/checkout\/orders\/(\w+)\/authorize$/))) {
      const o = orders[m[1]];
      if (!o) return send(404, { message: "order not found" });
      const amount = o.purchase_units[0].amount;
      return send(201, { id: m[1], status: "COMPLETED", purchase_units: [{ payments: { authorizations: [{ id: id("AUTH"), status: "CREATED", amount, expiration_time: new Date(Date.now() + 29 * 86400000).toISOString() }] } }] });
    }
    if ((m = p.match(/^\/v2\/payments\/authorizations\/(\w+)\/capture$/))) return send(201, { id: id("CAP"), status: "COMPLETED", final_capture: body.final_capture });
    if ((m = p.match(/^\/v2\/payments\/authorizations\/(\w+)\/void$/))) return send(204);
    if ((m = p.match(/^\/v2\/payments\/authorizations\/(\w+)\/reauthorize$/))) return send(201, { id: id("AUTH"), status: "CREATED", expiration_time: new Date(Date.now() + 26 * 86400000).toISOString() });
    return send(404, { message: `mock: no route ${req.method} ${p}` });
  });

  return new Promise((resolve) => server.listen(port, () => resolve({ calls, base, close: () => server.close() })));
}
