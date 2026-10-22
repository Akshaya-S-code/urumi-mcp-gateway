import "dotenv/config";
import { createApiKey, authenticateApiKey } from "./database.js";

const existingKey = process.env.URUMI_GATEWAY_API_KEY;

if (!existingKey) {
  throw new Error("URUMI_GATEWAY_API_KEY is missing from .env");
}

if (authenticateApiKey(existingKey)) {
  console.log("An API key is already registered; no new key created.");
} else {
  const created = createApiKey("bootstrap-admin", "admin");

  // The database module stores only the hash. Replace the temporary
  // generated key with a record for the existing environment key.
  console.error(
    "Bootstrap needs a dedicated import function before proceeding. No key was migrated."
  );

  throw new Error("Migration stopped safely; existing key remains unchanged.");
}
