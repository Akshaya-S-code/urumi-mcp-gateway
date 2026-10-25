# Submission notes and current limits

Use these notes to describe the implementation accurately in the application form and demo. The attached assignment asks for a live demonstration; source code and configuration alone do not prove a live VPS or full user journey.

## Suggested form answers

- **Multi-store provisioning bonus:** No. The implementation provisions one WooCommerce store and has not attempted tenant-isolated multi-store setup.
- **Production-like VPS deployment:** Production values and deployment instructions are implemented for the same Helm charts, but no VPS deployment has been performed. If the form means a live VPS, do not claim one.
- **Tool permissions:** Yes. API keys have admin/member roles; members cannot discover or call the admin-only product and order mutations.
- **OAuth on the Gateway:** No. The Gateway uses per-user bearer API keys. WooCommerce server-side requests use OAuth 1.0a.
- **Handling many tools:** The Gateway aggregates nine tools from three upstream servers (WooCommerce, Analytics, Inventory). It has not been load-tested with a large tool catalog.
- **Hosted MCP servers:** No. The three MCP servers run inside Kubernetes.
- **Security hardening:** Yes. Includes hashed API keys, role enforcement, encrypted optional upstream credentials, upstream URL restrictions, request timeouts, Secrets, and NetworkPolicies.
- **Scaling:** Limited. Upstream workloads have Kubernetes resource settings; horizontal Gateway scaling is intentionally off because its persistent SQLite database is single-writer. No load or failover test has been performed.
- **Observability:** Gateway audit records and upstream health/status are implemented. Prometheus metrics and distributed tracing are not implemented.
- **Upgrades and rollback:** Helm upgrade configuration and rollback guidance are included. Local Helm upgrades were exercised; production rollback has not been exercised.

## LLM and provider

The local chat agent uses **Qwen2.5 3B through Ollama** on the developer's Windows machine. The Gateway pod connects to the host Ollama server using `host.docker.internal:11434`. There is no hosted LLM provider in this configuration.

## Verified in the local environment

- Docker verification image: all workspace type checks/builds passed and the isolated Gateway API-key/database test passed.
- Helm lint passed for both charts; local and production values rendered successfully.
- The existing WooCommerce API key matched the WordPress credentials. The failure was caused by signing against the internal Service URL instead of WordPress's canonical `http://localhost:8081` URL. The MCP services now sign with the canonical URL and connect through Kubernetes DNS.
- Authenticated live calls through the Gateway succeeded for WooCommerce product listing, Analytics sales summary, and Inventory low-stock listing.

## Still required for the recorded definition-of-done demo

The local cluster is running, but the following must be captured live before claiming the full assignment demo is complete:

1. A User A chat product creation, a storefront checkout, and the same order returned by chat.
2. A separate User B key used with MCP Inspector or another external Streamable HTTP client.
3. A cross-upstream request, audit attribution, member-key revocation, disabled-upstream discovery, and dead-upstream isolation.
4. A real production-like VPS deployment, if claiming that optional item.

The detailed command-by-command walkthrough is in [current-cluster.md](current-cluster.md), and the recording outline is in [demo-guide.md](demo-guide.md). Never include API keys, WooCommerce credentials, or customer data in the submission video.
