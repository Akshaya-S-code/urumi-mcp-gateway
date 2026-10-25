# Urumi MCP Gateway

A single Streamable HTTP MCP endpoint aggregates WooCommerce, analytics, and inventory tools. The Gateway authenticates per-user API keys, applies role checks to discovery and calls, records audit events, and serves the dashboard chat agent.

## Architecture

- Store: WordPress, WooCommerce, and MariaDB in Kubernetes. WordPress content and MariaDB data use persistent volume claims.
- WooCommerce MCP: a custom Streamable HTTP server that calls the WooCommerce REST API using server-side OAuth 1.0a credentials.
- Analytics and Inventory MCP: separate Streamable HTTP servers that read WooCommerce data.
- Gateway: MCP client to each configured upstream and one authenticated MCP server for all clients. Tool names use upstream prefixes such as woo__list_orders.
- Dashboard: React UI for upstreams, API keys, audit logs, and chat. Chat calls the Gateway as the API-key identity entered by the user.
- Chat model: Ollama-compatible /api/chat endpoint. Set OLLAMA_BASE_URL and OLLAMA_MODEL for the model you run.

`WOOCOMMERCE_URL` is the canonical store URL reported by the WordPress REST API index and is used to sign OAuth requests. `WOOCOMMERCE_CONNECT_URL` can point at the in-cluster WordPress Service while requests carry the canonical Host and forwarded protocol. This distinction is required when WordPress is installed behind a local port-forward or TLS ingress. The optional user-provided upstream credential is encrypted in SQLite with AES-256-GCM. The encryption key must be a Kubernetes Secret and must remain stable across restarts; losing it makes saved credentials unreadable. Admin-supplied URLs are checked for metadata and non-public IP targets, rechecked before each request, and redirects are blocked. Private endpoints require an exact hostname in `UPSTREAM_ALLOWED_HOSTS`; credentialed public endpoints must use HTTPS. DNS checks do not pin the address used by the socket, so egress NetworkPolicies and firewall rules remain important.

## Local Kind setup (PowerShell)

Prerequisites: Docker Desktop, Kind, kubectl, Helm, Node.js 22+, npm, and Ollama with the configured model pulled. The steps below use the local Kind cluster and the same Helm charts used by production values.

For copy-and-paste beginner instructions in Windows PowerShell, follow [docs/windows-quickstart.md](docs/windows-quickstart.md). To continue using the already-running `urumi-local` cluster in this workspace, use [docs/current-cluster.md](docs/current-cluster.md). The full setup details and architecture notes remain below.

1. Create the Kind cluster with host ports 80 and 443 mapped: kind create cluster --name urumi --config deploy/local/kind-config.yaml. The cluster disables Kind's default CNI so NetworkPolicy can be enforced. Install Calico with .\deploy\local\install-calico.ps1. Then install Traefik with the same chart style used by k3s: helm upgrade --install traefik traefik --repo https://traefik.github.io/charts -n traefik --create-namespace -f deploy/local/traefik-values.yaml. The local Kind port mappings forward host ports 80/443 to Traefik NodePorts 30000/30001. See the [Kind port mapping guide](https://kind.sigs.k8s.io/docs/user/configuration/), [Calico Kind guide](https://docs.tigera.io/calico/latest/getting-started/kubernetes/kind), and [Traefik Helm chart documentation](https://doc.traefik.io/traefik/setup/kubernetes/).
2. Map these names to 127.0.0.1 in the Windows hosts file:
   - dashboard.urumi.local
   - gateway.urumi.local
   - store.urumi.local
3. Optionally run `npm.cmd ci` and `npm.cmd run build` on Windows. `better-sqlite3` may require Visual Studio's Desktop development with C++ workload for this host-only check. If C: is low on space, skip the host install and use the Docker image builds below; their Dockerfiles install dependencies inside Linux containers. Move Docker Desktop's disk image to a drive with space before building. Build the images from the repository root:
   - docker build -f Dockerfile.service --build-arg SERVICE_NAME=@urumi/gateway -t urumi-gateway:local .
   - docker build -f Dockerfile.service --build-arg SERVICE_NAME=@urumi/woo-mcp -t urumi-woo-mcp:local .
   - docker build -f Dockerfile.service --build-arg SERVICE_NAME=@urumi/analytics-mcp -t urumi-analytics-mcp:local .
   - docker build -f Dockerfile.service --build-arg SERVICE_NAME=@urumi/inventory-mcp -t urumi-inventory-mcp:local .
   - docker build -f apps/dashboard/Dockerfile -t urumi-dashboard:local .
   - docker build -f services/store-wordpress/Dockerfile -t urumi-wordpress:local .
4. Load each of those six images with kind load docker-image --name urumi IMAGE_NAME (run once for each image).
5. Create the store database Secret by running .\deploy\local\new-store-secret.ps1. Do not use this local helper for production secrets.
6. Install the store first:
   helm upgrade --install urumi-store deploy/helm/store -n urumi-store -f deploy/local/store-values.yaml
   Open http://store.urumi.local, finish WordPress setup, activate WooCommerce, and create a WooCommerce REST API key with read/write access. Enable Cash on Delivery for the demo.
7. Run .\deploy\local\new-app-secret.ps1 and enter the WooCommerce REST consumer key and secret when prompted. It creates the urumi namespace and application Secret. Save the displayed bootstrap key in a password manager; you will paste it into the dashboard. The encryption key is generated separately and remains inside the Secret. If you use port-forwarding to complete WordPress setup, inspect the REST API index URL and set `WOOCOMMERCE_URL` to that exact canonical URL in each MCP values file. For example, when the index reports `http://localhost:8081`, add `--set-string 'env[1].value=http://localhost:8081'` to each WooCommerce, Analytics, and Inventory Helm upgrade. `WOOCOMMERCE_CONNECT_URL` remains the in-cluster WordPress Service.
8. Install services into the same namespace so the Gateway-only NetworkPolicy selectors match:
   helm upgrade --install urumi-dashboard deploy/helm/platform -n urumi -f deploy/local/dashboard-values.yaml
   helm upgrade --install urumi-woo-mcp deploy/helm/platform -n urumi -f deploy/local/woo-mcp-values.yaml
   helm upgrade --install urumi-analytics-mcp deploy/helm/platform -n urumi -f deploy/local/analytics-mcp-values.yaml
   helm upgrade --install urumi-inventory-mcp deploy/helm/platform -n urumi -f deploy/local/inventory-mcp-values.yaml
   helm upgrade --install urumi-gateway deploy/helm/platform -n urumi -f deploy/local/gateway-values.yaml
9. Open http://dashboard.urumi.local. In API Keys, enter the bootstrap Gateway key. The dashboard derives http://gateway.urumi.local from its hostname; verify the Gateway connection and discover tools.

The dashboard and Gateway use Ingress. Upstream MCP services use ClusterIP Services and are not exposed through Ingress. Ingress NetworkPolicies on all three MCP services only allow pods labeled as the Gateway release; NetworkPolicy enforcement depends on a CNI that implements Kubernetes NetworkPolicy.

### Store and Gateway secrets

The chart expects Secrets to exist before their workloads start. In urumi-store, create urumi-store-db with mariadb-root-password and mariadb-password. In namespace urumi, create urumi-app-secrets with the four application keys listed above. The Gateway key is a bearer key used by the user; the encryption key is a separate 32-byte hex value. WooCommerce consumer credentials come from WooCommerce > Settings > Advanced > REST API.

## Demo checklist

1. Add a product to cart in the storefront, complete checkout with Cash on Delivery, and verify the order in WooCommerce admin.
2. As User A, use an admin key in dashboard chat to create a product. Verify it appears in the storefront. Place an order on the storefront and ask chat for today's orders.
3. Create a member key for User B. Connect an MCP client to http://gateway.urumi.local/mcp using Streamable HTTP and Authorization: Bearer <User B key>. Verify discovery includes enabled upstreams and omits admin-only mutations.
4. Ask User B for today's orders and for a prompt requiring both WooCommerce and Inventory or Analytics. Verify the response and audit rows.
5. Revoke User B's key and confirm the next MCP call gets HTTP 401. Disable an upstream and verify its tools disappear. Scale or delete an upstream pod and verify other tools still work and the affected server is shown as unavailable.

MCP client configuration must use the Gateway URL and the member's own API key. Never configure WooCommerce credentials in an external client.

## Production-like k3s

The deploy/production directory provides values for the same two charts. Replace registry.example.com, example.com, image tags, Ollama URL/model, storage class, and TLS Secret names for your VPS. Configure DNS for dashboard, gateway, and store. k3s includes Traefik by default; otherwise install a compatible Ingress controller. Create TLS Secrets in namespace urumi for dashboard and Gateway and in urumi-store for WordPress. Create application/database Secrets with the same key names described above; provide them through your secret manager or sealed-secret workflow rather than committing values.

Build and push the same six images to your registry. Install the store in namespace `urumi-store` and the platform releases in namespace `urumi`:

```powershell
helm upgrade --install urumi-store deploy/helm/store -n urumi-store --create-namespace -f deploy/production/store-values.yaml
helm upgrade --install urumi-dashboard deploy/helm/platform -n urumi --create-namespace -f deploy/production/dashboard-values.yaml
helm upgrade --install urumi-woo-mcp deploy/helm/platform -n urumi -f deploy/production/woo-mcp-values.yaml
helm upgrade --install urumi-analytics-mcp deploy/helm/platform -n urumi -f deploy/production/analytics-mcp-values.yaml
helm upgrade --install urumi-inventory-mcp deploy/helm/platform -n urumi -f deploy/production/inventory-mcp-values.yaml
helm upgrade --install urumi-gateway deploy/helm/platform -n urumi -f deploy/production/gateway-values.yaml
```

Ensure the cluster CNI enforces NetworkPolicy. Use a durable StorageClass and keep the Gateway SQLite PVC single-writer; do not scale Gateway replicas while using SQLite. Back up the Gateway database and the WordPress/MariaDB PVCs.

Production differences are values only: image references, DNS/Ingress/TLS, storage class/capacity, Ollama endpoint, CORS origin, and Kubernetes Secret names/values. Do not place secret material in Helm values files. For an upgrade, use helm upgrade with the same release and chart values. For rollback, use helm history and helm rollback after checking PVC and database compatibility.

## API overview

- GET /health: process health.
- POST /mcp: authenticated Streamable HTTP MCP endpoint.
- GET/POST /admin/api-keys and DELETE /admin/api-keys/:id: admin key management.
- GET/POST/PATCH/DELETE /admin/upstreams: admin upstream management.
- GET /admin/audit-logs: admin audit view.
- POST /chat: authenticated chat agent.

API keys are stored as SHA-256 hashes. Upstream credential values are encrypted at rest and are never included in the admin upstream response. Member calls to create_product and update_order_status are rejected and audited as denied. Upstream requests and model calls have configured timeouts.

## Design and threat model

See docs/system-design.md and docs/threat-model.md for architecture, tradeoffs, credential handling, and trust boundaries.

See [docs/submission-notes.md](docs/submission-notes.md) for verified capabilities, known limits, and accurate suggested answers for the assignment form.

Use [docs/demo-guide.md](docs/demo-guide.md) as a timed walkthrough for the required two-user demo video. The guide also lists the live-cluster evidence to capture and the checks to perform before recording.

## Verification status

Verification commands are `docker build -f Dockerfile.verify -t urumi-project-verify:local .`, both `helm lint` commands, and `helm template` for each local and production values file. The verification Dockerfile installs Linux dependencies in Docker, type-checks every workspace, and runs the Gateway database tests against an isolated temporary SQLite file.
