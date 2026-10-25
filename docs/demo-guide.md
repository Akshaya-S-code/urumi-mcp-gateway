# Round 1 demo video guide

Use this as a recording checklist after the local Kind demo is running. Target 8-10 minutes. Show the live dashboard, storefront, MCP client, and terminal; do not present screenshots or expected output as proof of a live run.

## Before recording

- Follow the local Kind setup in the root README and wait for every pod in `urumi-system` and `urumi-store` to become Ready.
- Complete WordPress setup, activate WooCommerce, enable Cash on Delivery, and create a read/write WooCommerce REST key.
- Create the Gateway bootstrap key and configure the three upstreams. Open **MCP Servers** and refresh; confirm Woo, Analytics, and Inventory each show Connected and their discovered tools.
- Create a member key for User B. Keep the admin key for User A and the member key separate.
- Verify `http://store.urumi.local`, `http://dashboard.urumi.local`, and `http://gateway.urumi.local/health` resolve from the recording machine. Warm up the configured Ollama model once.
- Use demo-only store data. Keep all API keys and WooCommerce credentials out of the recording.

## Suggested walkthrough

1. **Architecture and live workloads (about 1 minute).** Show the dashboard, Gateway, three MCP services, WordPress, and MariaDB. In the terminal run `kubectl get pods,pvc,ingress -n urumi-system` and `kubectl get pods,pvc,ingress -n urumi-store`. Explain that the dashboard and Gateway use Ingress, MCP upstreams use ClusterIP Services, SQLite data and WordPress/MariaDB data use PVCs, and credentials come from Kubernetes Secrets. Show one deployment's probes and resource settings with `kubectl describe deployment -n urumi-system urumi-gateway-platform` (adjust the deployment name if Helm reports a different name).

2. **Store order (about 45 seconds).** Open the storefront, add a product to the cart, and complete checkout with Cash on Delivery. Show the resulting order in WooCommerce admin.

3. **User A chat and product creation (about 1 minute).** In the dashboard, enter User A's admin API key. Ask the Chat Agent to create a clearly named simple product with a test price. Show the tool calls and verify the product appears in the storefront. Place an order for that product manually, then ask the agent for today's orders and show the matching order.

4. **User B external MCP client (about 1 minute).** Configure MCP Inspector (or Claude Code/Cursor) with only `http://gateway.urumi.local/mcp` and User B's bearer API key using Streamable HTTP. Do not configure a WooCommerce URL or WooCommerce credential in the client. Show that discovery lists tools from all three enabled upstreams and omits `woo__create_product` and `woo__update_order_status` for the member role. Call `woo__list_orders` and confirm the order appears.

5. **One request using two upstreams (about 45 seconds).** Ask the external client or chat: “Find a product, check its stock, and summarize today's sales.” Show calls to WooCommerce plus Inventory and Analytics. The exact product and today's totals depend on the demo store data.

6. **Access control, audit, and failure isolation (about 1.5 minutes).** In the dashboard, show recent audit rows with key label, server, tool, duration, and outcome. Revoke User B's key and make another MCP request to show HTTP 401. Recreate a temporary member key for the remainder of the demo if needed. Disable Analytics in the dashboard and show its tools disappear from discovery; re-enable it. To demonstrate a dead upstream, run `kubectl delete pod -n urumi-system -l app.kubernetes.io/instance=urumi-inventory-mcp`, refresh server status while the replacement pod starts, and show Inventory as Unreachable while WooCommerce and Analytics remain usable. Wait for the pod to recover before ending.

7. **Security and production story (about 1 minute).** Explain that API keys are random and stored as hashes; WooCommerce credentials are Kubernetes Secrets; optional admin-configured upstream credentials are AES-256-GCM encrypted in Gateway SQLite; user bearer keys are never forwarded upstream; members can read shared store data but cannot manage keys/upstreams or use admin-only mutations. Show the local and production values directories and explain that both deploy the same Helm charts, while domains/TLS, image references, storage classes, Ollama URL, and Secret references change. Mention CNI enforcement, single-replica Gateway for SQLite, backup needs, and the documented Helm upgrade/rollback commands.

## Evidence to capture

- Connected/Disabled/Unreachable status and live tool discovery in the dashboard.
- A real COD order in WooCommerce admin and the same order returned by chat and User B's MCP client.
- A product creation confirmed on the storefront.
- A cross-upstream request, per-user audit rows, a revoked-key HTTP 401, disabled tools disappearing, and one upstream failing without taking down the others.
- Pods, PVCs, Ingresses, probes, resource requests/limits, Secret references, and the Gateway-only NetworkPolicy selectors.

The Kubernetes and end-to-end evidence above must be captured from a live cluster. The source build alone does not prove the demo flow.
