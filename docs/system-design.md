# System design and tradeoffs

## Request path

The dashboard and external MCP clients call one authenticated Streamable HTTP endpoint on the Gateway. For each request, the Gateway connects to enabled upstream MCP servers, discovers their tools, and exposes names prefixed by the configured upstream name. For example, a WooCommerce list_orders tool is exposed as woo__list_orders. This deterministic prefix prevents collisions between upstream tool names.

The Gateway connects to enabled upstreams in parallel, then routes a call to the MCP client for the matching upstream. Each upstream request has a bounded timeout. Failed upstreams are omitted from discovery for that request and reported as unavailable by gateway__list_upstreams; one slow server does not make healthy servers wait for its timeout. This design favors simple request-scoped connections over connection pooling. It has more connection overhead but avoids stale MCP sessions in a small assignment deployment.

## Identity and authorization

API keys are generated with cryptographic randomness and only their SHA-256 hashes are stored. The database associates each key ID with a label and admin/member role. Chat uses the same bearer key as MCP and forwards it to the Gateway endpoint, so each tool call is authorized and logged under that key identity. Members do not receive admin mutation tools in discovery, and direct calls are rejected and audited.

Audit events retain key label, role, upstream, tool, timestamp, duration, and outcome. Gateway SQLite uses a persistent volume in Kubernetes. Because SQLite is single-writer, the chart uses one Gateway replica; horizontal Gateway scaling requires a shared database and session/concurrency design.

## Secrets and upstream credentials

WooCommerce REST credentials are mounted into the WooCommerce, Analytics, and Inventory pods from Kubernetes Secrets. Browser code and external MCP clients receive neither these values nor upstream authentication headers. For an admin-configured upstream, the Gateway encrypts the optional static header value using AES-256-GCM before storing it in SQLite. The 32-byte key is read from UPSTREAM_CREDENTIALS_ENCRYPTION_KEY. Store that key separately and back it up; rotating or losing it requires re-entering saved upstream credentials.

Admin-supplied upstream URLs are checked for HTTP(S), embedded credentials, metadata hostnames, and non-public DNS/IP targets. Private targets require an exact hostname in UPSTREAM_ALLOWED_HOSTS. The Gateway repeats DNS checks before requests and rejects redirects. Credentialed public endpoints require HTTPS. This is defense in depth, not a replacement for egress NetworkPolicies or firewall rules because DNS is not pinned to the socket connection.

Local and production values allowlist the three built-in MCP Service names and restrict ingress to the WooCommerce, Analytics, and Inventory MCP pods to the Gateway release label. The dashboard overview uses the admin upstream status probe and shows the probe failure reason rather than placeholder server data.

## Local and production

Both environments use deploy/helm/platform and deploy/helm/store. Values supply image names, replicas, resource requests and limits, probes, Ingress, URLs, storage classes, and Secret references. Local Kind uses .local hostnames and local images. A VPS uses DNS names, TLS Secrets, a registry, a durable storage class, and its cluster's Ingress controller. Secret data is created in Kubernetes separately from the values files.
