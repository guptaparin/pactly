"use client";
import { useEffect, useRef, useState } from "react";

const SUGGESTIONS = [
  "How much money is held right now, and for which deals?",
  "Which pacts need my decision?",
  "Is any deal risky?",
  "Summarize the reel edit pact and what the seller must fix",
];

const TOOL_LABEL = {
  list_pacts: "Read ledger", get_pact: "Opened pact", draft_pact: "Drafted pact",
  propose_release: "Proposed release", propose_revision: "Proposed revision", propose_cancel: "Proposed cancel",
};

export default function Agent() {
  const [msgs, setMsgs] = useState([
    { role: "assistant", text: "Hi, I'm your Pactly agent. Ask me about your deals, paste a chat to draft a new pact, or tell me what to do with a delivery. I'll propose any money movement for you to confirm." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function send(text) {
    const t = (text ?? input).trim();
    if (!t || busy) return;
    const next = [...msgs, { role: "user", text: t }];
    setMsgs(next); setInput(""); setBusy(true);
    try {
      const r = await fetch("/api/agent", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.filter((m) => !m.system).map(({ role, text }) => ({ role, text })) }),
      });
      const d = await r.json();
      setMsgs([...next, d.error ? { role: "assistant", text: `⚠️ ${d.error}`, system: true } : { role: "assistant", ...d }]);
    } catch (e) {
      setMsgs([...next, { role: "assistant", text: `⚠️ ${e.message}`, system: true }]);
    }
    setBusy(false);
  }

  async function confirm(mi, pi) {
    const prop = msgs[mi].proposals[pi];
    const set = (patch) => setMsgs((ms) => ms.map((m, i) => i !== mi ? m : { ...m, proposals: m.proposals.map((x, j) => j !== pi ? x : { ...x, ...patch }) }));
    set({ state: "running" });
    const r = await fetch(`/api/pacts/${prop.pactId}/${prop.action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(prop.body) });
    const d = await r.json();
    set(r.ok ? { state: "done" } : { state: "error", error: d.error });
  }

  return (
    <>
      <h1 style={{ fontSize: 40 }}>Talk to your agent</h1>
      <p className="lede">The agent reads your ledger and drafts pacts itself. Releases, refunds and cancellations are always proposed for you to confirm: the AI never moves money on its own.</p>
      <div className="card chat">
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.steps?.length > 0 && (
              <div className="tools">{[...new Set(m.steps)].map((s) => <span key={s} className="pill s-pending">{TOOL_LABEL[s] || s}</span>)}</div>
            )}
            <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
            {m.proposals?.map((p, j) => (
              <div key={j} className="proposal">
                <div><b>Proposed action:</b> {p.label}</div>
                <div className="small muted">{p.reason}</div>
                <div className="row" style={{ marginTop: 8 }}>
                  {p.state === "done" ? <span className="ok">✓ Done via PayPal — <a href={`/pact/${p.pactId}`}>view pact</a></span>
                    : p.state === "error" ? <span className="no">✗ {p.error}</span>
                    : <>
                        <button className="green" disabled={p.state === "running"} onClick={() => confirm(i, j)}>{p.state === "running" ? "Executing…" : "Confirm"}</button>
                        <a className="small" href={`/pact/${p.pactId}`}>Open pact</a>
                      </>}
                </div>
              </div>
            ))}
          </div>
        ))}
        {busy && <div className="bubble assistant muted">Agent is thinking…</div>}
        <div ref={endRef} />
      </div>
      {msgs.length < 3 && (
        <div className="row" style={{ marginTop: 12 }}>
          {SUGGESTIONS.map((s) => <button key={s} className="ghost small" onClick={() => send(s)}>{s}</button>)}
        </div>
      )}
      <div className="row" style={{ marginTop: 12, flexWrap: "nowrap" }}>
        <textarea style={{ minHeight: 52, flex: 1 }} value={input} placeholder="Ask anything, or paste a deal chat…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button onClick={() => send()} disabled={busy || !input.trim()}>Send</button>
      </div>
    </>
  );
}
