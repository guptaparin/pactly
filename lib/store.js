// Minimal JSON-file store (swap for Postgres in production). Keeps a full audit trail per pact.
import fs from "fs";
import path from "path";

const FILE = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "pacts.json");

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return {}; }
}
function save(db) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

export const store = {
  all: () => Object.values(load()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  get: (id) => load()[id],
  put(pact) { const db = load(); db[pact.id] = pact; save(db); return pact; },
  update(id, fn) {
    const db = load();
    if (!db[id]) throw new Error("Pact not found");
    fn(db[id]);
    db[id].updatedAt = new Date().toISOString();
    save(db);
    return db[id];
  },
};

export function log(pact, actor, event, detail) {
  pact.audit = pact.audit || [];
  pact.audit.push({ at: new Date().toISOString(), actor, event, detail });
}

export function heldAmount(p) {
  if (!p.authorizationId || p.status === "voided") return 0;
  return +(p.amount - (p.released || 0)).toFixed(2);
}
