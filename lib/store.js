// Pact storage. Uses Upstash Redis (free, via Vercel Storage) when configured,
// otherwise a local JSON file for development. Keeps a full audit trail per pact.
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

const FILE = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "pacts.json");
const readFile = () => { try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return {}; } };

const backend = REDIS_URL
  ? {
      async get(id) { const v = await redis("HGET", KEY, id); return v ? JSON.parse(v) : undefined; },
      async all() { const v = (await redis("HVALS", KEY)) || []; return v.map((x) => JSON.parse(x)); },
      async set(p) { await redis("HSET", KEY, p.id, JSON.stringify(p)); },
    }
  : {
      async get(id) { return readFile()[id]; },
      async all() { return Object.values(readFile()); },
      async set(p) {
        const db = readFile(); db[p.id] = p;
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
      },
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

export function log(pact, actor, event, detail) {
  pact.audit = pact.audit || [];
  pact.audit.push({ at: new Date().toISOString(), actor, event, detail });
}

// Money still held = milestones not yet released or refunded (partial releases return the rest).
export function heldAmount(p) {
  if (!p.authorizationId || ["voided", "settled"].includes(p.status)) return 0;
  return +p.milestones
    .filter((m) => !["released", "refunded"].includes(m.status))
    .reduce((s, m) => s + m.amount, 0)
    .toFixed(2);
}
