import Database from "better-sqlite3";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.resolve(here, "../data");
const databasePath = process.env.GATEWAY_DATABASE_PATH
  ? path.resolve(process.env.GATEWAY_DATABASE_PATH)
  : path.join(dataDirectory, "gateway.sqlite");

import fs from "node:fs";
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TEXT
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_id TEXT,
    key_label TEXT,
    role TEXT,
    server_name TEXT,
    tool_name TEXT,
    occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    duration_ms INTEGER,
    outcome TEXT NOT NULL,
    FOREIGN KEY (key_id) REFERENCES api_keys(id)
  );
`);

// Keep existing SQLite volumes usable when this service is upgraded in place.
const auditColumns = new Set(
  (db.pragma("table_info(audit_logs)") as Array<{ name: string }>).map((column) => column.name),
);
if (!auditColumns.has("key_label")) db.exec("ALTER TABLE audit_logs ADD COLUMN key_label TEXT");
if (!auditColumns.has("server_name")) db.exec("ALTER TABLE audit_logs ADD COLUMN server_name TEXT");

export type ApiRole = "admin" | "member";

export interface ApiKeyRecord {
  id: string;
  label: string;
  role: ApiRole;
  created_at: string;
  revoked_at: string | null;
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function createApiKey(label: string, role: ApiRole) {
  const rawKey = `urumi_${randomBytes(32).toString("base64url")}`;
  const id = randomBytes(12).toString("hex");

  db.prepare(`
    INSERT INTO api_keys (id, label, key_hash, role)
    VALUES (?, ?, ?, ?)
  `).run(id, label, hashKey(rawKey), role);

  return { id, label, role, key: rawKey };
}

export function authenticateApiKey(rawKey: string): ApiKeyRecord | null {
  if (!rawKey || rawKey.length > 256) return null;

  const record = db.prepare(`
    SELECT id, label, role, created_at, revoked_at, key_hash
    FROM api_keys
    WHERE key_hash = ?
  `).get(hashKey(rawKey)) as
    | (ApiKeyRecord & { key_hash: string })
    | undefined;

  if (!record || record.revoked_at) return null;

  const actual = Buffer.from(hashKey(rawKey), "hex");
  const expected = Buffer.from(record.key_hash, "hex");

  if (
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    return null;
  }

  return {
    id: record.id,
    label: record.label,
    role: record.role,
    created_at: record.created_at,
    revoked_at: record.revoked_at,
  };
}

export function revokeApiKey(id: string): boolean {
  const result = db.prepare(`
    UPDATE api_keys
    SET revoked_at = CURRENT_TIMESTAMP
    WHERE id = ? AND revoked_at IS NULL
  `).run(id);

  return result.changes > 0;
}

export function listApiKeys(): ApiKeyRecord[] {
  return db.prepare(`
    SELECT id, label, role, created_at, revoked_at
    FROM api_keys
    ORDER BY created_at DESC
  `).all() as ApiKeyRecord[];
}

export function recordAuditEvent(event: {
  keyId: string | null;
  keyLabel: string | null;
  role: ApiRole | null;
  serverName: string;
  toolName: string;
  durationMs: number;
  outcome: "success" | "error" | "denied";
}): void {
  db.prepare(`
    INSERT INTO audit_logs
      (key_id, key_label, role, server_name, tool_name, duration_ms, outcome)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.keyId,
    event.keyLabel,
    event.role,
    event.serverName,
    event.toolName,
    event.durationMs,
    event.outcome,
  );
}

export function listAuditEvents(limit = 100) {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  return db.prepare(`
    SELECT id, key_id, key_label, role, server_name, tool_name, occurred_at, duration_ms, outcome
    FROM audit_logs
    ORDER BY id DESC
    LIMIT ?
  `).all(safeLimit);
}

export function closeDatabase(): void {
  db.close();
}

export function importExistingAdminKey(rawKey: string): void {
  if (!rawKey || rawKey.length > 256) {
    throw new Error("Invalid admin key");
  }

  const existing = db.prepare(`
    SELECT id FROM api_keys WHERE key_hash = ?
  `).get(hashKey(rawKey)) as { id: string } | undefined;

  if (existing) {
    // Revocation is durable across restarts. The configured bootstrap secret
    // may seed a missing database, but must never resurrect a revoked key.
    return;
  }

  db.prepare(`
    INSERT INTO api_keys (id, label, key_hash, role)
    VALUES (?, ?, ?, 'admin')
  `).run(
    randomBytes(12).toString("hex"),
    "bootstrap-admin",
    hashKey(rawKey),
  );
}
