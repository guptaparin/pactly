"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import dynamic from "next/dynamic";

const ChannelChart = dynamic(() => import("./ChannelChart"), { ssr: false, loading: () => <div style={{ height: 200 }} /> });

const cur = (c) => (c === "USD" || !c ? "$" : `${c} `);
const money = (v, c) => `${cur(c)}${Number(v || 0).toFixed(2)}`;
const MONEY_EVENTS = new Set(["funds_held", "funds_captured", "funds_returned", "hold_voided", "deadline_enforced", "hold_renewed", "injection_blocked", "tracking_added", "order_created"]);
const SOURCE = { playground: ["Chat playground", "src-pg"], telegram: ["Telegram", "src-tg"], mcp: ["AI agent · MCP", "src-mcp"], "agent-chat": ["Agent chat", "src-agent"], web: ["Web", "src-web"] };
const SUGGESTIONS = ["Which deals need my decision?", "Risky deals", "Deals with money still held, biggest first", "Everything that came from Telegram or an AI agent", "Holds that expire within a day"];

// ---------- cell renderers ----------
function PactCell({ data }) {
  if (data.isTotal) return <b>Totals · {data.count} pacts</b>;
  const [label, cls] = SOURCE[data.source] || SOURCE.web;
  return (
    <span className="pact-cell">
      <a href={`/pact/${data.id}`} title={data.title}>{data.title}</a>
      <span className="badges">
        <span className={`src ${cls}`}>{label}</span>
        {data.demo && <span className="src src-demo">demo</span>}
        {data.flagged && <span className="src src-flag" title="A delivery tried to manipulate the AI verifier">⚠ blocked attack</span>}
        <span className="parties">{data.parties}</span>
      </span>
    </span>
  );
}

function EscrowBar({ data }) {
  const total = data.amount || 0;
  if (!total) return null;
  const seg = (v) => `${Math.max(0, (v / total) * 100)}%`;
  return (
    <div className="escrow" title={`${money(data.released, data.currency)} released · ${money(data.held, data.currency)} held · ${money(data.returned, data.currency)} returned`}>
      <div className="bar">
        {data.released > 0 && <span className="b-rel" style={{ width: seg(data.released) }} />}
        {data.held > 0 && <span className="b-held" style={{ width: seg(data.held) }} />}
        {data.returned > 0 && <span className="b-ret" style={{ width: seg(data.returned) }} />}
      </div>
      <div className="escrow-label">
        {data.released > 0 && <span><i className="dot rel" />{money(data.released, data.currency)}</span>}
        {data.held > 0 && <span><i className="dot held" />{money(data.held, data.currency)}</span>}
        {data.returned > 0 && <span><i className="dot ret" />{money(data.returned, data.currency)}</span>}
        {!data.released && !data.held && !data.returned && <span className="muted">{data.isTotal ? "" : "not funded"}</span>}
      </div>
    </div>
  );
}

// PayPal honors an authorization for 3 days; after that the agent reauthorizes once (valid to day 29).
function HoldClock({ data }) {
  if (data.isTotal) return null;
  if (data.honorHoursLeft == null) return <span className="muted small">—</span>;
  const h = data.honorHoursLeft;
  const pct = Math.max(0, Math.min(100, (h / 72) * 100));
  const tone = h <= 0 ? "clock-out" : h < 24 ? "clock-low" : "clock-ok";
  return (
    <div className="clock" title="PayPal honor period: the window in which the held funds are guaranteed for capture">
      <div className={`clock-bar ${tone}`}><span style={{ width: `${pct}%` }} /></div>
      <span className="small">{h <= 0 ? (data.renewed ? "renewed once" : "agent will renew") : `${Math.floor(Math.round(h) / 24) ? `${Math.floor(Math.round(h) / 24)}d ` : ""}${Math.round(h) % 24}h left`}{data.renewed && h > 0 ? " · renewed" : ""}</span>
    </div>
  );
}

function RiskMeter({ value, data }) {
  if (data.isTotal || value == null) return null;
  const tone = value >= 60 ? "var(--red)" : value >= 30 ? "var(--amber)" : "var(--green)";
  return (
    <div className="risk-meter" title={(data.riskFlags || []).join("\n") || "No red flags"}>
      <div><span style={{ width: `${value}%`, background: tone }} /></div>
      <b style={{ color: tone }}>{value}</b>
    </div>
  );
}

function NextCell({ value, data }) {
  if (data.isTotal) return null;
  const tone = /Blocked|manipulation/.test(value) ? "na-red" : /Buyer decision|Buyer review|Both|Buyer to fund/.test(value) ? "na-amber" : value === "Done" ? "na-done" : "na-wait";
  return <span className={`na ${tone}`}>{value}</span>;
}

// ---------- page ----------
export default function Dashboard() {
  const [pacts, setPacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [focus, setFocus] = useState(null);
  const grid = useRef(null);
  const moves = useRef(null);

  const load = () => fetch("/api/pacts").then((r) => r.json()).then((d) => { setPacts(d); return d; });
  useEffect(() => { load().then((d) => { if (!d.length) loadDemo(); }); }, []); // empty ledger: show the demo states
  async function loadDemo() { setLoading(true); await fetch("/api/demo", { method: "POST" }); await load(); setLoading(false); }

  const rows = useMemo(() => pacts.map((p) => {
    const funded = p.status === "funded" && p.authorizationId;
    const honorEnd = p.honorEndsAt || (p.authCreatedAt && new Date(new Date(p.authCreatedAt).getTime() + 3 * 86400000).toISOString());
    return {
      ...p,
      parties: `${p.buyer || "Buyer"} → ${p.seller || "Seller"}`,
      source: p.source || "web",
      flagged: p.milestones.some((m) => m.verdict?.flagged || m.history?.some((h) => h.verdict?.flagged)),
      honorHoursLeft: funded && honorEnd ? +((new Date(honorEnd) - Date.now()) / 3600000).toFixed(1) : null,
      renewed: !!p.reauthorizedAt,
    };
  }), [pacts]);

  const totals = useMemo(() => {
    const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
    return { isTotal: true, count: rows.length, amount: sum("amount"), held: sum("held"), released: sum("released"), returned: sum("returned"), currency: "USD" };
  }, [rows]);

  const movements = useMemo(() => pacts.flatMap((p) => (p.audit || [])
    .filter((a) => MONEY_EVENTS.has(a.event))
    .map((a) => ({ ...a, pactId: p.id, pact: p.title, demo: !!p.demo }))), [pacts]);

  const kpi = {
    held: totals.held, released: totals.released, returned: totals.returned,
    decisions: rows.filter((r) => /Buyer decision|Buyer review|Both/.test(r.nextAction)).length,
    blocked: movements.filter((m) => m.event === "injection_blocked").length + rows.filter((r) => r.status === "draft" && r.riskScore >= 60).length,
  };

  const cols = useMemo(() => [
    { field: "title", headerName: "Pact", minWidth: 320, flex: 2.2, filter: "agTextColumnFilter", cellRenderer: PactCell, pinned: "left" },
    { field: "parties", hide: true, filter: "agTextColumnFilter" },
    { field: "buyer", hide: true, filter: "agTextColumnFilter" },
    { field: "seller", hide: true, filter: "agTextColumnFilter" },
    { field: "source", hide: true, filter: "agTextColumnFilter" },
    { field: "currency", hide: true, filter: "agTextColumnFilter" },
    { field: "status", width: 118, flex: 0, filter: "agTextColumnFilter", cellRenderer: (p) => p.data.isTotal ? null : <span className={`pill s-${p.value}`}>{p.value}</span> },
    { field: "nextAction", headerName: "Waiting on", minWidth: 190, filter: "agTextColumnFilter", cellRenderer: NextCell },
    { colId: "escrow", headerName: "Released · Held · Returned", minWidth: 240, flex: 1.6, cellRenderer: EscrowBar, sortable: false, comparator: (a, b, x, y) => x.data.held - y.data.held },
    { field: "amount", width: 108, flex: 0, filter: "agNumberColumnFilter", valueFormatter: (p) => money(p.value, p.data.currency) },
    { field: "held", width: 105, hide: true, filter: "agNumberColumnFilter", valueFormatter: (p) => money(p.value, p.data.currency) },
    { field: "released", width: 115, hide: true, filter: "agNumberColumnFilter", valueFormatter: (p) => money(p.value, p.data.currency) },
    { field: "returned", width: 115, hide: true, filter: "agNumberColumnFilter", valueFormatter: (p) => money(p.value, p.data.currency) },
    { field: "honorHoursLeft", headerName: "PayPal hold clock", minWidth: 165, filter: "agNumberColumnFilter", cellRenderer: HoldClock },
    { field: "riskScore", headerName: "Scam risk", width: 128, flex: 0, filter: "agNumberColumnFilter", cellRenderer: RiskMeter },
    { field: "createdAt", headerName: "Created", hide: true, sort: "desc", valueFormatter: (p) => p.value?.slice(0, 10) || "" },
  ], []);

  const moveCols = useMemo(() => [
    { field: "at", headerName: "When", width: 160, sort: "desc", valueFormatter: (p) => p.value?.slice(0, 16).replace("T", " ") },
    { field: "pact", headerName: "Pact", minWidth: 200, flex: 1, filter: "agTextColumnFilter", cellRenderer: (p) => <a href={`/pact/${p.data.pactId}`}>{p.value}</a> },
    { field: "actor", width: 150, filter: "agTextColumnFilter" },
    { field: "event", width: 160, filter: "agTextColumnFilter", cellRenderer: (p) => <span className={`ev ev-${p.value}`}>{p.value.charAt(0).toUpperCase() + p.value.slice(1).replace(/_/g, " ")}</span> },
    { field: "detail", flex: 2, minWidth: 320, filter: "agTextColumnFilter", tooltipField: "detail" },
    { field: "paypalId", headerName: "PayPal id", width: 190, cellClass: "mono" },
  ], []);

  async function ask(q) {
    const text = (q ?? question).trim();
    if (!text) return;
    setQuestion(text); setAsking(true); setAnswer(null);
    try {
      const r = await fetch("/api/ledger-query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text, rows }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      grid.current.api.setFilterModel(d.filterModel);
      grid.current.api.applyColumnState({ state: d.sort, defaultState: { sort: null } });
      setAnswer({ text: d.answer, filters: Object.keys(d.filterModel) });
    } catch (e) { setAnswer({ text: `⚠️ ${e.message}`, filters: [] }); }
    setAsking(false);
  }
  function clearView() {
    grid.current.api.setFilterModel(null);
    grid.current.api.applyColumnState({ state: [{ colId: "createdAt", sort: "desc" }], defaultState: { sort: null } });
    setAnswer(null); setQuestion("");
  }
  useEffect(() => { moves.current?.api?.onFilterChanged(); }, [focus]);

  return (
    <div className="wide">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 40, marginBottom: 4 }}>Escrow control room</h1>
          <p className="muted" style={{ margin: 0 }}>Every pact from the web, Telegram and AI agents, with the money PayPal is holding right now.</p>
        </div>
        <div className="row">
          <button className="ghost" onClick={() => grid.current.api.exportDataAsCsv({ fileName: "pactly-ledger.csv", columnKeys: ["title", "buyer", "seller", "status", "nextAction", "amount", "held", "released", "returned", "riskScore", "source", "createdAt"] })}>Export CSV</button>
          <button className="ghost" onClick={loadDemo} disabled={loading}>{loading ? "Loading…" : "Load demo pacts"}</button>
        </div>
      </div>

      <div className="kpis">
        <div><span>Held by PayPal now</span><b>{money(kpi.held)}</b></div>
        <div><span>Released to sellers</span><b>{money(kpi.released)}</b></div>
        <div><span>Returned to buyers</span><b>{money(kpi.returned)}</b></div>
        <div className={kpi.decisions ? "kpi-amber" : ""}><span>Waiting on a decision</span><b>{kpi.decisions}</b></div>
        <div className={kpi.blocked ? "kpi-red" : ""}><span>Scams &amp; attacks stopped</span><b>{kpi.blocked}</b></div>
      </div>

      <div className="card ask">
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()}
            placeholder="Ask your ledger… e.g. “which deals over $100 are still waiting on delivery?”" />
          <button onClick={() => ask()} disabled={asking || !question.trim()}>{asking ? "Thinking…" : "Ask"}</button>
          {answer && <button className="ghost" onClick={clearView}>Clear</button>}
        </div>
        {!answer && <div className="row" style={{ marginTop: 10 }}>{SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => ask(s)}>{s}</button>)}</div>}
        {answer && (
          <div className="answer">
            <span className="ai-tag">AI</span> {answer.text}
            {answer.filters.length > 0 && <span className="muted small"> · grid filtered by {answer.filters.join(", ")}</span>}
          </div>
        )}
      </div>

      <div className="card ag-theme-quartz pactly-grid" style={{ height: Math.min(700, 112 + Math.max(rows.length, 3) * 58), padding: 0, overflow: "hidden" }}>
        <AgGridReact ref={grid} rowData={rows} columnDefs={cols} pinnedBottomRowData={[totals]}
          defaultColDef={{ sortable: true, resizable: true, flex: 1, floatingFilter: false }}
          rowHeight={58} getRowId={(p) => p.data.id}
          rowClassRules={{ "row-risk": (p) => !p.data.isTotal && p.data.riskScore >= 60, "row-flag": (p) => p.data.flagged, "row-focus": (p) => p.data.id === focus }}
          onRowClicked={(e) => !e.data.isTotal && setFocus((f) => (f === e.data.id ? null : e.data.id))}
          overlayNoRowsTemplate="No pacts yet. Load the demo pacts or create one." />
      </div>

      <div className="card" style={{ paddingBottom: 10 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Where the money is, by channel</h2>
          <span className="small muted">Hover a bar for amounts · AG Charts</span>
        </div>
        {rows.length > 0 && <ChannelChart rows={rows} />}
      </div>

      <div className="row" style={{ justifyContent: "space-between", marginTop: 26 }}>
        <h2 style={{ margin: 0 }}>Money movements</h2>
        <span className="small muted">{focus ? <>Showing one pact · <a href="#" onClick={(e) => { e.preventDefault(); setFocus(null); }}>show all</a></> : "Click a pact above to focus it"}</span>
      </div>
      <div className="card ag-theme-quartz pactly-grid" style={{ height: 340, padding: 0, overflow: "hidden" }}>
        <AgGridReact ref={moves} rowData={movements} columnDefs={moveCols} defaultColDef={{ sortable: true, resizable: true }}
          isExternalFilterPresent={() => !!focus} doesExternalFilterPass={(n) => n.data.pactId === focus}
          tooltipShowDelay={300} rowHeight={40} />
      </div>
      <p className="small muted">Grids by AG Grid Community, chart by AG Charts. “Ask your ledger” turns your question into an AG Grid filter and sort model with AI; the server checks it against a column whitelist before it is applied.</p>
    </div>
  );
}
