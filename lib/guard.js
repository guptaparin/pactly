// Guardrails between the AI and the money.
// 1. Prompt-injection screening of everything a seller submits (it is untrusted input to the verifier).
// 2. Deterministic checks that a verdict is internally consistent before any PayPal capture can follow it.

const PATTERNS = [
  [/ignore (all |any |the )?(previous|prior|above|earlier|your)? ?(instructions|rules|criteria|prompt)/i, "asks the verifier to ignore its instructions"],
  [/disregard (the |all |any )?(criteria|instructions|rules|contract)/i, "asks the verifier to disregard the criteria"],
  [/\b(system|developer)\s*(prompt|message|override|note)\b/i, "pretends to be a system message"],
  [/^\s*(system|assistant)\s*:/im, "pretends to be a system message"],
  [/\byou are (now |an? )?(the )?(verifier|ai|assistant|model|escrow)/i, "tries to re-define the verifier's role"],
  [/\b(as|dear|attention|note to) (the )?(ai|verifier|model|escrow agent|llm|assistant)\b/i, "addresses the AI verifier directly"],
  [/\b(release|approve|pay|capture)\b[^.\n]{0,40}\b(100 ?%|full(y)?|all (the )?(money|funds|payment)|immediately)\b/i, "instructs the verifier to release money"],
  [/\b(mark|set|treat)\b[^.\n]{0,30}\b(all )?(criteria|checks)\b[^.\n]{0,20}\b(met|passed|true)\b/i, "instructs the verifier to mark criteria as met"],
  [/releasePercent|"decision"\s*:/i, "injects verifier output fields"],
  [/\bjailbreak|\bDAN mode|\bpretend (that|you)/i, "contains a jailbreak phrase"],
];

// Returns [{ reason, excerpt }] for every suspicious phrase found in the seller's text.
export function scanForInjection(...texts) {
  const text = texts.flat().filter(Boolean).join("\n");
  const hits = [];
  for (const [re, reason] of PATTERNS) {
    const m = text.match(re);
    if (m && !hits.some((h) => h.reason === reason)) {
      const i = Math.max(0, m.index - 20);
      hits.push({ reason, excerpt: text.slice(i, m.index + m[0].length + 20).replace(/\s+/g, " ").trim() });
    }
  }
  return hits;
}

const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

// Make the verdict safe to act on, whatever the model said.
export function enforceVerdict(verdict, hits = []) {
  const v = { ...verdict, checks: Array.isArray(verdict.checks) ? verdict.checks : [] };
  v.releasePercent = clamp(v.releasePercent);
  const total = v.checks.length;
  const met = v.checks.filter((c) => c.met).length;
  const notes = [];

  if (total && met < total && (v.decision === "release" || v.releasePercent === 100)) {
    v.decision = "partial";
    v.releasePercent = Math.min(v.releasePercent || 90, 90);
    notes.push("Capped below 100% because not every criterion is met");
  }
  if (total && met === 0 && v.releasePercent > 0) {
    v.decision = "hold"; v.releasePercent = 0;
    notes.push("No criterion is met, so nothing is released");
  }
  if (v.decision === "hold") v.releasePercent = 0;
  if (v.decision === "release" && v.releasePercent < 100) v.decision = "partial";

  const modelFlag = v.injectionDetected === true;
  if (hits.length || modelFlag) {
    v.flagged = true;
    v.injection = {
      detectedBy: [hits.length && "pattern screen", modelFlag && "verifier model"].filter(Boolean),
      reasons: [...new Set([...hits.map((h) => h.reason), ...(v.injectionEvidence ? [v.injectionEvidence] : [])])],
      excerpts: hits.map((h) => h.excerpt).slice(0, 3),
    };
    v.modelSuggestedPercent = v.releasePercent;
    v.decision = "hold";
    v.releasePercent = 0;
    v.summary = `Manipulation attempt detected in the submission (${v.injection.reasons[0]}). Nothing is released automatically; the buyer must review the work personally. ${v.summary || ""}`.trim();
  }
  if (notes.length) v.guardNotes = notes;
  return v;
}
