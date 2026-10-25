import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const testDirectory = mkdtempSync(path.join(os.tmpdir(), "urumi-gateway-test-"));
process.env.GATEWAY_DATABASE_PATH = path.join(testDirectory, "gateway.sqlite");

const {
  authenticateApiKey,
  closeDatabase,
  createApiKey,
  listApiKeys,
  revokeApiKey,
} = await import("./database.js");

after(() => {
  closeDatabase();
  rmSync(testDirectory, { recursive: true, force: true });
});

test("API keys authenticate, are listed without the raw key, and stay revoked", () => {
  const created = createApiKey("database-test", "member");

  assert.equal(authenticateApiKey(created.key)?.id, created.id);
  assert.equal(authenticateApiKey(created.key)?.role, "member");
  assert.equal(listApiKeys().some((record) => "key" in record), false);
  assert.equal(revokeApiKey(created.id), true);
  assert.equal(authenticateApiKey(created.key), null);
  assert.equal(revokeApiKey(created.id), false);
});