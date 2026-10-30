"use client";
// AG Charts: where the money sits, per channel the deal came from.
// Colors validated with the dataviz palette checker (CVD + normal-vision separation); legend + tooltips carry identity,
// and the grid above is the table view.
import { AgCharts } from "ag-charts-react";

export const ESCROW_COLORS = { released: "#1f7a4d", held: "#c8861a", returned: "#3f6fc4" };
const LABEL = { playground: "Chat playground", telegram: "Telegram", mcp: "AI agents (MCP)", "agent-chat": "Agent chat", web: "Web" };
const money = (v) => `$${Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export default function ChannelChart({ rows }) {
  const by = {};
  for (const r of rows) {
    const k = LABEL[r.source] || "Web";
    by[k] = by[k] || { channel: k, released: 0, held: 0, returned: 0, pacts: 0 };
    by[k].released += r.released || 0; by[k].held += r.held || 0; by[k].returned += r.returned || 0; by[k].pacts += 1;
  }
  const data = Object.values(by).sort((a, b) => b.released + b.held + b.returned - (a.released + a.held + a.returned));
  const series = [["released", "Released to sellers"], ["held", "Held by PayPal"], ["returned", "Returned to buyers"]].map(([k, name]) => ({
    type: "bar", direction: "horizontal", xKey: "channel", yKey: k, yName: name, stacked: true,
    fill: ESCROW_COLORS[k], stroke: "#fffdf8", strokeWidth: 2, cornerRadius: 4,
    tooltip: { renderer: ({ datum, yName }) => ({ heading: datum.channel, title: yName, data: [{ label: "Amount", value: money(datum[k]) }, { label: "Pacts from this channel", value: String(datum.pacts) }] }) },
  }));
  return (
    <AgCharts options={{
      data, series, height: Math.max(170, 64 + data.length * 44),
      background: { fill: "#fffdf8" },
      padding: { top: 6, right: 16, bottom: 6, left: 6 },
      axes: [
        { type: "category", position: "left", label: { color: "#1b1d22", fontFamily: "Inter", fontSize: 12 }, line: { enabled: false } },
        { type: "number", position: "bottom", label: { formatter: ({ value }) => money(value), color: "#6b6a66", fontFamily: "Inter", fontSize: 11 }, gridLine: { style: [{ stroke: "#ece6da", lineDash: [] }] } },
      ],
      legend: { position: "top", item: { label: { color: "#1b1d22", fontFamily: "Inter", fontSize: 12 }, marker: { shape: "square" } } },
    }} />
  );
}
