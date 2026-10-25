# Threat model

## Assets

- WooCommerce consumer key and secret.
- Gateway API keys and team roles.
- Optional credentials for admin-configured MCP servers.
- Customer, order, product, inventory, and sales data.
- Integrity of tool calls and audit history.

## Trust boundaries

The browser and external MCP clients are untrusted. They receive only a Gateway URL and their own API key. The Gateway, its SQLite volume, Kubernetes Secrets, and MCP pods are trusted components. An upstream MCP server is also untrusted as a source of tool descriptions and results, even when its credentials are stored by the Gateway.

## Controls

- API keys are random bearer tokens; only hashes are stored and revocation is checked on each request. The bootstrap key seeds a missing database record but does not undo a revocation when the Gateway restarts.
- Admin endpoints require an admin key. Member tool discovery hides mutations and direct mutation calls are rejected and audited.
- A Gateway API key identifies a caller to the Gateway only. The Gateway does not forward that client bearer token upstream; it attaches only the server-side credential configured for that upstream. This prevents an upstream from receiving a reusable team key and keeps authorization and revocation under Gateway control.
- Upstream credentials are applied by the Gateway HTTP client and excluded from admin API responses. Stored optional credentials are authenticated ciphertext; the encryption key lives in a Kubernetes Secret.
- Admin-supplied upstream URLs reject metadata hostnames, resolve DNS during validation and again before each request, reject non-public IP ranges unless the exact hostname is in `UPSTREAM_ALLOWED_HOSTS`, and do not follow redirects. Credentialed public endpoints must use HTTPS. Local and production values allowlist only the three built-in MCP Service names.
- Upstream names prefix tool names to avoid ambiguity. MCP input schemas are passed through, and known store mutations receive Gateway-side schema validation.
- Upstream connections and tool calls have timeouts. A failed upstream does not prevent other upstreams from being used.
- MCP pods use ClusterIP Services, not public Ingress. Local and production values restrict ingress to all three MCP pods to the Gateway release label; the store policy restricts MariaDB ingress to WordPress. These policies require a CNI that enforces Kubernetes NetworkPolicy.
- Request bodies and chat message sizes are bounded. The dashboard keeps the entered API key in page memory only.

## Residual risks and operating rules

- An admin can register a malicious MCP endpoint. Its tool descriptions or output can try to influence the chat model. The system prompt treats tool output as data, but model prompt instructions are not a security boundary. Review upstream code and permissions before registration.
- The Gateway still makes requests to admin-supplied URLs. DNS revalidation reduces rebinding risk but does not pin the resolved address through the socket connection. Restrict who has admin keys and use network egress controls to block cloud metadata and other sensitive destinations. Add private Service hostnames to `UPSTREAM_ALLOWED_HOSTS` only after review.
- WooCommerce credentials are shared by server-side MCP pods. A member can invoke the tools permitted by their Gateway role, so grant the WooCommerce REST key only the permissions needed for those operations.
- Store data is shared between team members: a member can read data exposed by permitted tools and their allowed tools can change shared state. Members cannot inspect another member's API key, revoke it, manage upstreams, or use the admin-only product and order mutations. The system does not claim per-customer or per-member row-level isolation inside WooCommerce.
- SQLite and local-path storage are single-node choices. Back up volumes and use managed storage/database and a stronger multi-replica design for production.
- Kubernetes Secret values are base64-encoded by Kubernetes, not encrypted at rest by the application. Enable encryption at rest in the cluster and restrict RBAC access to Secrets.
- Audit rows are stored in the same SQLite database as keys. Restrict database volume access and export logs to a separate protected system for tamper resistance.
