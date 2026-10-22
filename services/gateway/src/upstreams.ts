import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.resolve(here, "../data");
fs.mkdirSync(dataDirectory, { recursive: true });

const db = new Database(path.join(dataDirectory, "gateway.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS upstreams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

export type UpstreamRecord = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

function normalize(row: any): UpstreamRecord {
  return { ...row, enabled: Boolean(row.enabled) };
}

export function listUpstreams(): UpstreamRecord[] {
  const rows = db.prepare(
    "SELECT * FROM upstreams ORDER BY name"
  ).all() as any[];
  return rows.map(normalize);
}

export function getUpstream(id: string): UpstreamRecord | undefined {
  const row = db.prepare("SELECT * FROM upstreams WHERE id = ?").get(id);
  return row ? normalize(row) : undefined;
}

export function addUpstream(name: string, url: string) {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO upstreams (id, name, url) VALUES (?, ?, ?)"
  ).run(id, name, url);
  return getUpstream(id)!;
}

export function updateUpstream(
  id: string,
  changes: { name?: string; url?: string; enabled?: boolean }
) {
  const current = getUpstream(id);
  if (!current) return undefined;

  db.prepare(`
    UPDATE upstreams
    SET name = ?, url = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    changes.name ?? current.name,
    changes.url ?? current.url,
    changes.enabled === undefined ? Number(current.enabled) : Number(changes.enabled),
    id
  );

  return getUpstream(id);
}

export function removeUpstream(id: string): boolean {
  return db.prepare("DELETE FROM upstreams WHERE id = ?").run(id).changes > 0;
}

export function seedUpstreams(defaults: Array<{ name: string; url: string }>) {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO upstreams (id, name, url) VALUES (?, ?, ?)"
  );
  const transaction = db.transaction(() => {
    for (const item of defaults) {
      insert.run(randomUUID(), item.name, item.url);
    }
  });
  transaction();
}
