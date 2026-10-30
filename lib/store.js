// Pact storage. Uses Upstash Redis (free, via Vercel Storage) when configured,
// otherwise a local JSON file for development. Keeps a full audit trail per pact.
// Also exposes a tiny key-value store (kv) used by the Telegram bot and the agent.
import fs from "fs";
import path from "path";

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KEY = "pactly:pacts";

async function redis(...cmd) {
  const r = await fetch(REDIS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  const d = await r.json();
  if (d.error) throw new Error(`Storage: ${d.error}`);
  return d.result;
}

const DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const FILE = path.join(DIR, "pacts.json");
const KV_FILE = path.join(DIR, "kv.json");
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return {}; } };
const writeJson = (f, v) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };

const backend = REDIS_URL
  ? {
      async get(id) { const v = await redis("HGET", KEY, id); return v ? JSON.parse(v) : undefined; },
      async all() { const v = (await redis("HVALS", KEY)) || []; return v.map((x) => JSON.parse(x)); },
      async set(p) { await redis("HSET", KEY, p.id, JSON.stringify(p)); },
    }
  : {
      async get(id) { return readJson(FILE)[id]; },
      async all() { return Object.values(readJson(FILE)); },
      async set(p) { const db = readJson(FILE); db[p.id] = p; writeJson(FILE, db); },
    };

export const store = {
  all: async () => (await backend.all()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  get: (id) => backend.get(id),
  async put(pact) { pact.updatedAt = new Date().toISOString(); await backend.set(pact); return pact; },
  async update(id, fn) {
    const p = await backend.get(id);
    if (!p) throw new Error("Pact not found");
    fn(p);
    return store.put(p);
  },
};

// Small JSON key-value store with optional expiry (seconds).
const fileKv = () => {
  const db = readJson(KV_FILE);
  const now = Date.now();
  for (const k of Object.keys(db)) if (db[k].exp && db[k].exp < now) delete db[k];
  return db;
};
export const kv = REDIS_URL
  ? {
      async get(k) { const v = await redis("GET", `pactly:${k}`); return v ? JSON.parse(v) : undefined; },
      async set(k, v, ttl) { await redis(...["SET", `pactly:${k}`, JSON.stringify(v)], ...(ttl ? ["EX", ttl] : [])); },
      // true if the key did not exist (and is now set): used for de-duplication and rate limits
      async claim(k, ttl = 3600) { return (await redis("SET", `pactly:${k}`, "1", "EX", ttl, "NX")) === "OK"; },
    }
  : {
      async get(k) { return fileKv()[k]?.v; },
      async set(k, v, ttl) { const db = fileKv(); db[k] = { v, exp: ttl ? Date.now() + ttl * 1000 : 0 }; writeJson(KV_FILE, db); },
      async claim(k, ttl = 3600) {
        const db = fileKv();
        if (db[k]) return false;
        db[k] = { v: 1, exp: Date.now() + ttl * 1000 }; writeJson(KV_FILE, db); return true;
      },
    };

export function log(pact, actor, event, detail, extra) {
  pact.audit = pact.audit || [];
  pact.audit.push({ at: new Date().toISOString(), actor, event, detail, ...(extra || {}) });
}

// Money still held = milestones not yet released or refunded (partial releases return the rest).
export function heldAmount(p) {
  if (!p.authorizationId || ["voided", "settled"].includes(p.status)) return 0;
  return +p.milestones
    .filter((m) => !["released", "refunded"].includes(m.status))
    .reduce((s, m) => s + m.amount, 0)
    .toFixed(2);
}

// Money that went back to the buyer (refunded milestones + unreleased share of partial releases).
export function returnedAmount(p) {
  if (!p.authorizationId && !p.demo) return 0;
  if (p.status === "draft") return 0;
  return +Math.max(0, p.amount - (p.released || 0) - heldAmount(p)).toFixed(2);
}

// What the pact is waiting for, in plain words (used by the ledger, bot and agent).
export function nextAction(p) {
  const m = p.milestones.find((x) => !["released", "refunded"].includes(x.status));
  if (p.status === "draft") return p.riskScore >= 60 ? "Blocked: high scam risk" : "Buyer to fund";
  if (["settled", "voided"].includes(p.status) || !m) return "Done";
  if (m.status === "pending") return m.history?.length ? "Seller to resubmit" : "Seller to deliver";
  if (m.status === "verified") return m.verdict?.flagged ? "Buyer review: manipulation flagged" : "Buyer decision";
  if (m.status === "disputed") return "Both to accept mediation";
  return "—";
}
