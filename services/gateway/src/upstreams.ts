import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

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
    credential_header TEXT,
    credential_ciphertext TEXT,
    credential_iv TEXT,
    credential_tag TEXT,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

const upstreamColumns = new Set(
  (db.pragma("table_info(upstreams)") as Array<{ name: string }>).map((column) => column.name),
);
for (const column of ["credential_header", "credential_ciphertext", "credential_iv", "credential_tag"]) {
  if (!upstreamColumns.has(column)) db.exec(`ALTER TABLE upstreams ADD COLUMN ${column} TEXT`);
}

function encryptionKey(): Buffer {
  const encoded = process.env.UPSTREAM_CREDENTIALS_ENCRYPTION_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(encoded)) {
    throw new Error("UPSTREAM_CREDENTIALS_ENCRYPTION_KEY must be a 32-byte hex value to store upstream credentials.");
  }
  return Buffer.from(encoded, "hex");
}

function encryptCredential(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { credential_iv: iv.toString("hex"), credential_ciphertext: ciphertext.toString("hex"), credential_tag: cipher.getAuthTag().toString("hex") };
}

export type UpstreamRecord = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  hasCredential: boolean;
  created_at: string;
  updated_at: string;
};

function normalize(row: any): UpstreamRecord {
  return {
    id: row.id, name: row.name, url: row.url, enabled: Boolean(row.enabled),
    hasCredential: Boolean(row.credential_ciphertext),
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

export function listUpstreams(): UpstreamRecord[] {
  const rows = db.prepare(
    "SELECT id, name, url, enabled, credential_ciphertext, created_at, updated_at FROM upstreams ORDER BY name"
  ).all() as any[];
  return rows.map(normalize);
}

export function getUpstream(id: string): UpstreamRecord | undefined {
  const row = db.prepare("SELECT * FROM upstreams WHERE id = ?").get(id);
  return row ? normalize(row) : undefined;
}

export function getUpstreamCredential(id: string): { header: string; value: string } | undefined {
  const row = db.prepare(`SELECT credential_header, credential_ciphertext, credential_iv, credential_tag FROM upstreams WHERE id = ?`).get(id) as
    | { credential_header: string | null; credential_ciphertext: string | null; credential_iv: string | null; credential_tag: string | null }
    | undefined;
  if (!row?.credential_ciphertext || !row.credential_iv || !row.credential_tag || !row.credential_header) return undefined;
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(row.credential_iv, "hex"));
  decipher.setAuthTag(Buffer.from(row.credential_tag, "hex"));
  const value = Buffer.concat([
    decipher.update(Buffer.from(row.credential_ciphertext, "hex")),
    decipher.final(),
  ]).toString("utf8");
  return { header: row.credential_header, value };
}

export function addUpstream(name: string, url: string, credential?: { header: string; value: string }) {
  const id = randomUUID();
  const encrypted = credential ? encryptCredential(credential.value) : undefined;
  db.prepare(
    `INSERT INTO upstreams (id, name, url, credential_header, credential_ciphertext, credential_iv, credential_tag)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, url, credential?.header ?? null, encrypted?.credential_ciphertext ?? null, encrypted?.credential_iv ?? null, encrypted?.credential_tag ?? null);
  return getUpstream(id)!;
}

export function updateUpstream(
  id: string,
  changes: { name?: string; url?: string; enabled?: boolean; credential?: { header: string; value: string }; clearCredential?: boolean }
) {
  const current = getUpstream(id);
  if (!current) return undefined;

  const encrypted = changes.credential ? encryptCredential(changes.credential.value) : undefined;
  db.prepare(`
    UPDATE upstreams
    SET name = ?, url = ?, enabled = ?,
        credential_header = CASE WHEN ? THEN NULL WHEN ? THEN ? ELSE credential_header END,
        credential_ciphertext = CASE WHEN ? THEN NULL WHEN ? THEN ? ELSE credential_ciphertext END,
        credential_iv = CASE WHEN ? THEN NULL WHEN ? THEN ? ELSE credential_iv END,
        credential_tag = CASE WHEN ? THEN NULL WHEN ? THEN ? ELSE credential_tag END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    changes.name ?? current.name,
    changes.url ?? current.url,
    changes.enabled === undefined ? Number(current.enabled) : Number(changes.enabled),
    Number(Boolean(changes.clearCredential)), Number(Boolean(encrypted)), changes.credential?.header ?? null,
    Number(Boolean(changes.clearCredential)), Number(Boolean(encrypted)), encrypted?.credential_ciphertext ?? null,
    Number(Boolean(changes.clearCredential)), Number(Boolean(encrypted)), encrypted?.credential_iv ?? null,
    Number(Boolean(changes.clearCredential)), Number(Boolean(encrypted)), encrypted?.credential_tag ?? null,
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
