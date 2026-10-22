# Urumi MCP Gateway

A local MCP gateway integrating WooCommerce, sales analytics, and inventory tools.

## Architecture

- **Gateway:** Authenticates API keys, discovers upstream MCP tools, forwards tool calls, and records audit events.
- **WooCommerce MCP:** Product and order operations.
- **Analytics MCP:** Sales summary tools.
- **Inventory MCP:** Stock lookup and low-stock tools.
- **Database:** SQLite storage for API-key metadata and audit logs.
- **Store:** Helm chart for WordPress and MariaDB.
- **Platform:** Generic Helm chart for Kubernetes workloads.

## Prerequisites

- Node.js 22 or later
- npm
- Docker Desktop and Kubernetes/Kind for local cluster deployment
- Helm and kubectl for Kubernetes validation

## Local setup

1. Install dependencies:

   ```powershell
   npm ci
   ```

2. Configure the required environment variables in a local `.env` file. Never commit real API keys or passwords.

3. Start the WooCommerce, analytics, and inventory MCP services using their package scripts and configured ports.

4. Start the Gateway:

   ```powershell
   npm run dev --workspace=@urumi/gateway
   ```

5. Check the health endpoint:

   ```powershell
   Invoke-RestMethod http://127.0.0.1:3002/health
   ```

## Gateway API

- `GET /health` — health check
- `POST /mcp` — authenticated MCP requests
- `GET /admin/api-keys` — list API-key metadata (admin only)
- `POST /admin/api-keys` — create an API key (admin only)
- `DELETE /admin/api-keys/:id` — revoke an API key (admin only)
- `GET /admin/audit-logs` — inspect audit events (admin only)

Authenticated requests use:

```text
Authorization: Bearer YOUR_API_KEY
```

Do not put real API keys in source code, logs, documentation, or version control.

## Development checks

Run from the repository root:

```powershell
npm run typecheck
npm run build
npm test
```

Validate Helm charts:

```powershell
helm lint ./deploy/helm/platform
helm lint ./deploy/helm/store
```

## Security notes

- API keys are stored as SHA-256 hashes.
- Revoked API keys are rejected.
- Admin endpoints require an active admin key.
- Product creation and order-status updates are restricted to admin keys in the Gateway.
- Audit events record tool names, caller roles, duration, and outcome.
- `.env` and local SQLite database files must remain untracked.

## Current verification

The local typecheck and build passed. The database test passed (1 test), and both Helm charts passed `helm lint`.

## Scope and limitations

The current platform Helm chart uses a generic image by default; it must be configured for the intended application before deploying the Gateway through that chart. Additional integration tests, upstream timeout and URL-validation protections, and end-to-end deployment verification should be completed before treating the platform as production-ready.
