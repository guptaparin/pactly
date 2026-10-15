"use client";
import { useEffect, useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";

const money = (p) => (p.value == null ? "" : `${p.data.currency} ${Number(p.value).toFixed(2)}`);

export default function Dashboard() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const load = () => fetch("/api/pacts").then((r) => r.json()).then(setRows);
  useEffect(() => { load(); }, []);
  async function loadDemo() { setLoading(true); await fetch("/api/demo", { method: "POST" }); await load(); setLoading(false); }

  const cols = useMemo(() => [
    { field: "title", flex: 2, filter: true, cellRenderer: (p) => <span><a href={`/pact/${p.data.id}`}>{p.value}</a>{p.data.demo && <span className="pill s-pending" style={{ marginLeft: 8 }}>demo</span>}</span> },
    { field: "buyer", filter: true }, { field: "seller", filter: true },
    { field: "status", cellRenderer: (p) => <span className={`pill s-${p.value}`}>{p.value}</span>, filter: true },
    { field: "amount", valueFormatter: money },
    { field: "held", headerName: "Held", valueFormatter: money },
    { field: "released", valueFormatter: money },
    { field: "riskScore", headerName: "Risk", cellStyle: (p) => ({ color: p.value >= 60 ? "#b3261e" : p.value >= 30 ? "#b26a00" : "#1f7a4d", fontWeight: 600 }) },
    { field: "createdAt", headerName: "Created", valueFormatter: (p) => p.value?.slice(0, 10), sort: "desc" },
  ], []);

  const totals = rows.reduce((t, r) => ({ held: t.held + (r.held || 0), released: t.released + (r.released || 0) }), { held: 0, released: 0 });

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ fontSize: 40 }}>Ledger</h1>
        <button className="ghost" onClick={loadDemo} disabled={loading}>{loading ? "Loading…" : "Load demo pacts"}</button>
      </div>
      <div className="row">
        <div className="card" style={{ flex: 1 }}><div className="muted small">Pacts</div><div className="money">{rows.length}</div></div>
        <div className="card" style={{ flex: 1 }}><div className="muted small">Currently held</div><div className="money">{totals.held.toFixed(2)}</div></div>
        <div className="card" style={{ flex: 1 }}><div className="muted small">Released to sellers</div><div className="money">{totals.released.toFixed(2)}</div></div>
      </div>
      <div className="card ag-theme-quartz" style={{ height: 480, padding: 0, overflow: "hidden" }}>
        <AgGridReact rowData={rows} columnDefs={cols} defaultColDef={{ sortable: true, resizable: true, flex: 1 }} pagination />
      </div>
    </>
  );
}
