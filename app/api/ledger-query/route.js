// "Ask your ledger": natural language -> validated AG Grid filter + sort model, plus a short answer.
// The model only proposes a view; it is checked against a column whitelist before reaching the grid.
import { NextResponse } from "next/server";
import { queryLedger } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const COLUMNS = {
  title: "text", buyer: "text", seller: "text", status: "text", nextAction: "text", source: "text", currency: "text",
  amount: "number", held: "number", released: "number", returned: "number", riskScore: "number", honorHoursLeft: "number",
};
const OPS = {
  text: ["contains", "notContains", "equals", "notEqual", "startsWith", "endsWith"],
  number: ["equals", "notEqual", "greaterThan", "greaterThanOrEqual", "lessThan", "lessThanOrEqual"],
};

export async function POST(req) {
  try {
    const { question, rows = [] } = await req.json();
    if (!question?.trim()) return NextResponse.json({ error: "Ask a question first." }, { status: 400 });
    const slim = rows.slice(0, 80).map((r) => Object.fromEntries(Object.keys(COLUMNS).map((k) => [k, r[k]])));
    const ai = await queryLedger(question.slice(0, 300), slim, COLUMNS);

    const filterModel = {};
    for (const f of ai.filters || []) {
      const kind = COLUMNS[f.column];
      if (!kind || !OPS[kind].includes(f.type)) continue;
      const value = kind === "number" ? Number(String(f.filter).replace(/[^\d.-]/g, "")) : String(f.filter);
      if (kind === "number" && !Number.isFinite(value)) continue;
      filterModel[f.column] = { filterType: kind, type: f.type, filter: value };
    }
    const sort = COLUMNS[ai.sortColumn] && ["asc", "desc"].includes(ai.sortDirection)
      ? [{ colId: ai.sortColumn, sort: ai.sortDirection }] : [];
    return NextResponse.json({ filterModel, sort, answer: ai.answer || "" });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
