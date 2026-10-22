import {
  createApiKey,
  authenticateApiKey,
  revokeApiKey,
} from "./database.js";

const created = createApiKey("database-test", "member");

if (!authenticateApiKey(created.key)) {
  throw new Error("New API key failed authentication");
}

if (revokeApiKey(created.id)) {
  if (authenticateApiKey(created.key) !== null) {
    throw new Error("Revoked API key was still accepted");
  }
} else {
  throw new Error("API key revocation failed");
}

console.log("PASS: key creation and authentication");
console.log("PASS: revoked key is rejected");
