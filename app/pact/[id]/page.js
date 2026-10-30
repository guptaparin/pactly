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
  const [tracking, setTracking] = useState("");
  const [carrier, setCarrier] = useState("");
  const [mandate, setMandate] = useState(false);
  const [flash, setFlash] = useState(null);
  const ppRef = useRef(null);
  const mandateRef = useRef(false);
  mandateRef.current = mandate;

  const load = () => fetch(`/api/pacts/${params.id}`).then((r) => r.json()).then(setP);
  useEffect(() => {
    load();
    const q = new URLSearchParams(location.search);
    if (q.get("role") === "seller") setRole("seller");
    if (q.get("funded")) setFlash({ tone: "green", text: "Funds are on hold with PayPal. Nothing is paid out until the delivery is verified." });
    if (q.get("cancelled")) setFlash({ tone: "blue", text: "PayPal checkout was cancelled. Nothing was charged." });
    if (q.get("error")) setFlash({ tone: "red", text: q.get("error") });
  }, []);

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
        createOrder: async () => (await act("order", { agentMayRelease: mandateRef.current }, "Creating PayPal order…")).id,
        onApprove: async (data) => { await act("authorize", { orderId: data.orderID, agentMayRelease: mandateRef.current }, "Placing hold…"); },
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
  const SRC = { playground: <a href="/try">Made in the chat playground ← back to the chat</a>, telegram: "Made in a Telegram chat", mcp: `Created by ${p.createdBy || "an AI agent"} over MCP`, "agent-chat": "Drafted by the Pactly agent", web: "" };
  const hoursLeft = p.honorEndsAt ? (new Date(p.honorEndsAt) - Date.now()) / 3600000 : null;

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginTop: 10 }}>
        <span className="row"><span className={`pill s-${p.status}`}>{p.status}</span>{SRC[p.source] && <span className="small muted">{SRC[p.source]}</span>}{p.nextAction && p.nextAction !== "Done" && <span className="small"><b>Waiting on:</b> {p.nextAction}</span>}</span>
        <div className="row small">
          Viewing as
          <button className={role === "buyer" ? "" : "ghost"} onClick={() => setRole("buyer")}>Buyer</button>
          <button className={role === "seller" ? "" : "ghost"} onClick={() => setRole("seller")}>Seller</button>
        </div>
      </div>
      {p.demo && <div className="risk" style={{ background: "var(--blue-bg)" }}><b>Demo pact (read-only).</b> <span className="small">It shows a lifecycle state without touching PayPal. <a href="/">Create a live pact</a> to try the real sandbox flow.</span></div>}
      <h1 style={{ fontSize: 38 }}>{p.title}</h1>
      <p className="lede">{p.summary}</p>
      {flash && <div className={`banner ${flash.tone}`}>{flash.text}</div>}
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
                  <span className="row">{ms.deadline && <span className="small muted">due {ms.deadline}</span>}<b>{fmt(ms.amount, p.currency)}</b><span className={`pill s-${ms.status}`}>{ms.status}</span></span>
                </div>
                <ul className="small muted">{ms.criteria.map((c, j) => <li key={j}>{c}</li>)}</ul>
                {ms.verdict?.flagged && (
                  <div className="banner red small">
                    <b>🚨 Manipulation attempt blocked.</b> The submission tried to influence the AI verifier ({ms.verdict.injection.reasons.join("; ")}).
                    Detected by {ms.verdict.injection.detectedBy.join(" and ")}. Nothing is released automatically and AI agents can&apos;t release it; only the buyer can decide.
                    {ms.verdict.injection.excerpts?.map((x, k) => <code key={k} className="excerpt">{x}</code>)}
                  </div>
                )}
                {ms.submission?.trackingNumber && <p className="small">📦 Tracking: <b>{ms.submission.carrier} {ms.submission.trackingNumber}</b>{ms.trackingRegistered && " · registered on the PayPal transaction"}</p>}
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
            <div className="card"><h2>Fund this pact</h2><p className="small muted">Your money is <b>held</b> by PayPal, not paid out. It only moves when the agent verifies delivery.</p>
              <label className="mandate"><input type="checkbox" checked={mandate} onChange={(e) => setMandate(e.target.checked)} />
                <span><b>Let AI agents release milestones the verifier fully approves.</b><br /><span className="muted small">{p.source === "mcp" ? `${p.createdBy || "Your agent"} opened this pact. ` : ""}Agents (over MCP) can then release up to the verifier&apos;s certified percentage, never a flagged delivery. Leave unticked to approve every release yourself.</span></span>
              </label>
              <div ref={ppRef} />
              <p className="small muted">Button not loading? <a href={`/api/pacts/${p.id}/fund`}>Pay on PayPal&apos;s page instead</a>.</p>
              <details className="small" style={{ marginTop: 10 }}><summary><b>Testing? Use the sandbox buyer account</b></summary>
                <p className="muted">PayPal sandbox, fake money. Click the yellow button, choose <b>Log In</b>, then use:</p>
                <div className="audit">Email: sb-fonqm53381183@personal.example.com<br />Password: K)&3+uHc</div>
                <p className="muted">Tip: an incognito window avoids PayPal reusing another login.</p>
              </details></div>
          )}
          {p.status === "draft" && role === "seller" && <div className="card muted">Waiting for the buyer to fund the pact.</div>}

          {p.status === "funded" && m && m.status === "pending" && role === "seller" && (
            <div className="card">
              <h2>Submit: {m.name}</h2>
              {m.history?.length > 0 && <div className="risk" style={{ background: "var(--amber-bg)" }}><b>Revision requested.</b> <span className="small">Last check: {m.history.at(-1).verdict?.summary}</span></div>}
              <label>Note to buyer</label>
              <textarea style={{ minHeight: 80 }} value={note} onChange={(e) => setNote(e.target.value)} />
              <label>Links (comma separated)</label>
              <input value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://drive.google.com/…" />
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <div style={{ flex: 2 }}><label>Shipment tracking number (goods)</label><input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="optional" /></div>
                <div style={{ flex: 1 }}><label>Carrier</label><input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="UPS, DHL…" /></div>
              </div>
              <label>Screenshots / files (images)</label>
              <input type="file" accept="image/*" multiple onChange={(e) => setFiles([...e.target.files])} />
              <div className="row" style={{ marginTop: 14 }}>
                <button disabled={!!busy} onClick={async () => {
                  const images = await Promise.all(files.map(toDataUrl));
                  await act("submit", { milestone: idx, note, links: links.split(",").map((s) => s.trim()).filter(Boolean), images, trackingNumber: tracking, carrier }, "Agent is checking every criterion…");
                  setNote(""); setLinks(""); setFiles([]); setTracking(""); setCarrier("");
                }}>Submit for AI verification</button>
              </div>
            </div>
          )}
          {p.status === "funded" && m?.status === "pending" && !p.demo && (
            <div className="card small">
              <b>Agent watch:</b> if “{m.name}” isn&apos;t delivered by {m.deadline || "its deadline"}, the agent voids the PayPal hold and returns the money automatically.
              <div style={{ marginTop: 8 }}><button className="ghost" disabled={!!busy} onClick={() => act("simulate-deadline", { milestone: idx }, "Advancing clock… agent is checking deadlines")}>⏩ Simulate missed deadline (demo)</button></div>
            </div>
          )}
          {p.status === "funded" && m?.status === "pending" && role === "buyer" && <div className="card muted">Funds are held. Waiting for the seller to {m.history?.length ? "resubmit" : "deliver"} “{m.name}”.</div>}

          {m?.status === "verified" && (
            <div className="card">
              <h2>Settle “{m.name}”</h2>
              {role === "buyer" ? (
                <div className="row">
                  {m.verdict.releasePercent > 0 && (
                    <button className="green" disabled={!!busy} onClick={() => act("approve", { milestone: idx }, "Capturing via PayPal…")}>Accept verdict — release {m.verdict.releasePercent}%</button>
                  )}
                  {m.verdict.releasePercent < 100 && (
                    <button disabled={!!busy} onClick={() => act("revise", { milestone: idx }, "Sending back to seller…")}>Ask seller to fix &amp; resubmit</button>
                  )}
                  {m.verdict.releasePercent < 100 && !m.verdict.flagged && (
                    <button className="ghost" disabled={!!busy} onClick={() => act("approve", { milestone: idx, percent: 100 }, "Capturing via PayPal…")}>Release 100% anyway</button>
                  )}
                  {m.verdict.flagged && (
                    <button className="ghost" disabled={!!busy} onClick={() => act("approve", { milestone: idx, percent: 100 }, "Capturing via PayPal…")}>I checked the work myself — release 100%</button>
                  )}
                  {m.verdict.releasePercent === 0 && (
                    <button className="ghost" disabled={!!busy} onClick={() => act("approve", { milestone: idx, percent: 0 }, "Returning funds…")}>Refund this milestone</button>
                  )}
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
            {p.status === "funded" && hoursLeft != null && (
              <div className="small" style={{ marginTop: 8 }} title="PayPal guarantees capture of an authorization for 3 days; the agent reauthorizes once after that (valid up to 29 days)">
                PayPal hold clock: <b>{hoursLeft > 0 ? `${Math.floor(Math.round(hoursLeft) / 24)}d ${Math.round(hoursLeft) % 24}h of honor period left` : "honor period over"}</b>
                {p.reauthorizedAt ? " · renewed by the agent" : hoursLeft <= 0 ? " · agent renews it on the next check" : ""}
                {p.authExpiresAt && <div className="muted">Authorization valid until {p.authExpiresAt.slice(0, 10)}</div>}
              </div>
            )}
            {p.agentMayRelease && <div className="small" style={{ marginTop: 8 }}>🤖 AI agents may release milestones the verifier fully approves.</div>}
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
