"use client";
import { useEffect, useRef, useState } from "react";

const fmt = (n, c) => `${c === "USD" ? "$" : c + " "}${Number(n || 0).toFixed(2)}`;
const toDataUrl = (f) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });

export default function PactPage({ params }) {
  const [p, setP] = useState(null);
  const [role, setRole] = useState("buyer");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [links, setLinks] = useState("");
  const [files, setFiles] = useState([]);
  const [buyerSays, setBuyerSays] = useState("");
  const [sellerSays, setSellerSays] = useState("");
  const ppRef = useRef(null);

  const load = () => fetch(`/api/pacts/${params.id}`).then((r) => r.json()).then(setP);
  useEffect(() => { load(); }, []);

  async function act(action, body = {}, label = action) {
    setBusy(label); setErr("");
    const r = await fetch(`/api/pacts/${params.id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    setBusy("");
    if (!r.ok) { setErr(d.error); return null; }
    await load();
    return d;
  }

  // PayPal JS SDK buttons with intent=authorize: buyer approves, server places the hold.
  useEffect(() => {
    if (!p || p.status !== "draft" || role !== "buyer" || !ppRef.current) return;
    const render = () => {
      ppRef.current.innerHTML = "";
      window.paypal.Buttons({
        style: { layout: "vertical", shape: "rect", label: "pay" },
        createOrder: async () => (await act("order", {}, "Creating PayPal order…")).id,
        onApprove: async (data) => { await act("authorize", { orderId: data.orderID }, "Placing hold…"); },
        onError: (e) => setErr(String(e)),
      }).render(ppRef.current);
    };
    if (window.paypal) return render();
    (async () => {
      const { paypalClientId } = await fetch("/api/config").then((r) => r.json());
      if (!paypalClientId) { setErr("PayPal client ID is not configured on the server (PAYPAL_CLIENT_ID)."); return; }
      const s = document.createElement("script");
      s.src = `https://www.paypal.com/sdk/js?client-id=${paypalClientId}&currency=${p.currency}&intent=authorize&components=buttons`;
      s.onload = render;
      s.onerror = () => setErr(`PayPal checkout could not load (currency ${p.currency}). Check the client ID, or disable ad-blockers for this site.`);
      document.body.appendChild(s);
    })();
  }, [p?.status, p?.currency, role]);

  if (!p) return <p className="muted">Loading pact…</p>;
  if (p.error) return <p className="err">{p.error}</p>;

  const idx = p.milestones.findIndex((m) => !["released", "refunded"].includes(m.status));
  const m = p.milestones[idx];
  const riskColor = p.riskScore >= 60 ? "var(--red-bg)" : p.riskScore >= 30 ? "var(--amber-bg)" : "var(--green-bg)";

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 10 }}>
        <span className={`pill s-${p.status}`}>{p.status}</span>
        <div className="row small">
          Viewing as
          <button className={role === "buyer" ? "" : "ghost"} onClick={() => setRole("buyer")}>Buyer</button>
          <button className={role === "seller" ? "" : "ghost"} onClick={() => setRole("seller")}>Seller</button>
        </div>
      </div>
      <h1 style={{ fontSize: 38 }}>{p.title}</h1>
      <p className="lede">{p.summary}</p>
      {err && <div className="err">{err}</div>}
      {busy && <div className="card small">⏳ {busy}</div>}

      <div className="grid2">
        <div>
          <div className="card">
            <h2>Milestones</h2>
            {p.milestones.map((ms, i) => (
              <div key={i} className="card" style={{ marginTop: 10, padding: 16 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <b>{ms.name}</b>
                  <span className="row"><b>{fmt(ms.amount, p.currency)}</b><span className={`pill s-${ms.status}`}>{ms.status}</span></span>
                </div>
                <ul className="small muted">{ms.criteria.map((c, j) => <li key={j}>{c}</li>)}</ul>
                {ms.verdict && (
                  <div className="small">
                    <b>Agent verification:</b>
                    {ms.verdict.checks.map((c, j) => (
                      <div className="check" key={j}><span className={c.met ? "ok" : "no"}>{c.met ? "✓" : "✗"}</span><div><b>{c.criterion}</b><div className="muted">{c.reason}</div></div></div>
                    ))}
                    <p><b>Recommendation:</b> {ms.verdict.decision} — release {ms.verdict.releasePercent}%. {ms.verdict.summary}</p>
                  </div>
                )}
                {ms.dispute && <p className="small"><b>Mediator proposal:</b> {ms.dispute.sellerPercent}% to seller. {ms.dispute.reasoning}</p>}
                {ms.releasedAmount != null && <p className="small ok">Released to seller: {fmt(ms.releasedAmount, p.currency)}</p>}
              </div>
            ))}
          </div>

          {/* Action panel for the current step */}
          {p.status === "draft" && role === "buyer" && (
            <div className="card"><h2>Fund this pact</h2><p className="small muted">Your money is <b>held</b> by PayPal, not paid out. It only moves when the agent verifies delivery.</p><div ref={ppRef} /></div>
          )}
          {p.status === "draft" && role === "seller" && <div className="card muted">Waiting for the buyer to fund the pact.</div>}

          {p.status === "funded" && m && m.status === "pending" && role === "seller" && (
            <div className="card">
              <h2>Submit: {m.name}</h2>
              <label>Note to buyer</label>
              <textarea style={{ minHeight: 80 }} value={note} onChange={(e) => setNote(e.target.value)} />
              <label>Links (comma separated)</label>
              <input value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://drive.google.com/…" />
              <label>Screenshots / files (images)</label>
              <input type="file" accept="image/*" multiple onChange={(e) => setFiles([...e.target.files])} />
              <div className="row" style={{ marginTop: 14 }}>
                <button disabled={!!busy} onClick={async () => {
                  const images = await Promise.all(files.map(toDataUrl));
                  await act("submit", { milestone: idx, note, links: links.split(",").map((s) => s.trim()).filter(Boolean), images }, "Agent is checking every criterion…");
                  setNote(""); setLinks(""); setFiles([]);
                }}>Submit for AI verification</button>
              </div>
            </div>
          )}
          {p.status === "funded" && m?.status === "pending" && role === "buyer" && <div className="card muted">Funds are held. Waiting for the seller to deliver “{m.name}”.</div>}

          {m?.status === "verified" && (
            <div className="card">
              <h2>Settle “{m.name}”</h2>
              {role === "buyer" ? (
                <div className="row">
                  <button className="green" disabled={!!busy} onClick={() => act("approve", { milestone: idx }, "Capturing via PayPal…")}>Accept verdict — release {m.verdict.releasePercent}%</button>
                  <button className="ghost" disabled={!!busy} onClick={() => act("approve", { milestone: idx, percent: 100 }, "Capturing via PayPal…")}>Release 100% anyway</button>
                </div>
              ) : <p className="muted small">The buyer can accept the agent&apos;s verdict, or either side can raise a dispute.</p>}
              <label>Dispute — buyer&apos;s side</label>
              <input value={buyerSays} onChange={(e) => setBuyerSays(e.target.value)} />
              <label>Dispute — seller&apos;s side</label>
              <input value={sellerSays} onChange={(e) => setSellerSays(e.target.value)} />
              <div className="row" style={{ marginTop: 12 }}><button className="red" disabled={!!busy} onClick={() => act("dispute", { milestone: idx, buyerSays, sellerSays }, "Mediator agent is reviewing…")}>Ask AI mediator</button></div>
            </div>
          )}
          {m?.status === "disputed" && (
            <div className="card"><h2>Resolve dispute</h2><p className="small">Both parties accept the mediator&apos;s proposal of <b>{m.dispute.sellerPercent}%</b> to the seller?</p>
              <button className="green" disabled={!!busy} onClick={() => act("resolve", { milestone: idx }, "Settling via PayPal…")}>Both accept — settle</button></div>
          )}
        </div>

        <div>
          <div className="card">
            <div className="muted small">Held by PayPal</div>
            <div className="money">{fmt(p.held, p.currency)}</div>
            <div className="muted small">Released to seller: {fmt(p.released, p.currency)} of {fmt(p.amount, p.currency)}</div>
            {p.deadline && <div className="small" style={{ marginTop: 8 }}>Deadline: <b>{p.deadline}</b></div>}
            {p.held > 0 && <button className="ghost" style={{ marginTop: 12 }} disabled={!!busy} onClick={() => act("cancel", { actor: role, reason: `Cancelled by ${role}` }, "Voiding hold…")}>Cancel & return held funds</button>}
            <div className="risk" style={{ background: riskColor }}>
              <b>Scam risk: {p.riskScore}/100</b>
              {p.riskFlags?.length ? <ul className="small">{p.riskFlags.map((f, i) => <li key={i}>{f}</li>)}</ul> : <div className="small">No red flags found in the chat.</div>}
            </div>
          </div>
          <div className="card audit"><h2 style={{ fontFamily: "Fraunces" }}>Audit trail</h2>
            {(p.audit || []).map((a, i) => <div key={i}><span className="muted">{a.at.slice(5, 16).replace("T", " ")}</span> [{a.actor}] <b>{a.event}</b><br />{a.detail}</div>)}
          </div>
        </div>
      </div>
    </>
  );
}
