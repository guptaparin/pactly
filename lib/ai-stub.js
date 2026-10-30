// Deterministic offline AI used only by the end-to-end test (AI_PROVIDER=stub). Never used in production.
const textOf = (content) => (typeof content === "string" ? content : content.filter((p) => p.type === "text").map((p) => p.text).join("\n"));

export function stub(name, content) {
  const t = textOf(content);
  if (name === "pact") {
    const amount = +(t.match(/\$(\d+(\.\d+)?)/)?.[1] || 100);
    const risky = /bank transfer|gift card|10 minutes/i.test(t);
    const two = /concepts/i.test(t);
    return {
      title: two ? "Bakery logo for Crumb & Co" : "Chat deal", buyer: "Riya", seller: "Arjun", amount, currency: "USD", deadline: "",
      summary: "Logo work agreed in chat.",
      milestones: two
        ? [{ name: "3 logo concepts", amount: 50, criteria: ["3 distinct concepts", "Croissant element"], deadline: "" },
           { name: "Final files", amount: amount - 50, criteria: ["PNG and SVG", "Transparent background"], deadline: "" }]
        : [{ name: "Full delivery", amount, criteria: ["Work delivered as agreed"], deadline: "" }],
      riskFlags: risky ? ["Off-platform payment pressure"] : [], riskScore: risky ? 80 : 5,
    };
  }
  if (name === "verdict") {
    const sub = t.split("<seller_submission>")[1] || "";
    const good = /croissant|png/i.test(sub);
    const crit = [...(t.split("Acceptance criteria:")[1] || "").split("<seller_submission>")[0].matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]);
    const [c1 = "Criterion 1", c2 = "Criterion 2"] = crit;
    return {
      checks: [{ criterion: c1, met: good, reason: good ? "Visible in the submitted evidence." : "Not shown in the evidence." },
               { criterion: c2, met: true, reason: "Visible in the submitted evidence." }],
      // a naive model fooled by the injection would say 100%: the guard must still block it
      decision: good || /release 100/i.test(sub) ? "release" : "partial",
      releasePercent: good || /release 100/i.test(sub) ? 100 : 50,
      summary: good ? "All criteria met." : "Criterion 1 is missing.",
      injectionDetected: false, injectionEvidence: "",
    };
  }
  if (name === "proposal") return { sellerPercent: 60, reasoning: "Most of the work was delivered." };
  if (name === "ledger_query") {
    return /risk/i.test(t)
      ? { filters: [{ column: "riskScore", filterType: "number", type: "greaterThan", filter: "50" }], sortColumn: "riskScore", sortDirection: "desc", answer: "One risky pact." }
      : { filters: [], answer: "Showing everything." };
  }
  return {};
}

export function stubTurn() {
  return { role: "model", parts: [{ text: "Stub agent reply." }] };
}
