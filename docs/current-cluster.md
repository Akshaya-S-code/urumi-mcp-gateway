# Continue with the existing Windows Kind cluster

Use this guide for the workspace's existing `urumi-local` cluster. It keeps the current namespaces, Helm releases, Secrets, PVCs, and WordPress data. Do not run the fresh-cluster creation or secret-generation steps from the quickstart for this cluster.

## 1. Confirm the cluster

From PowerShell:

```powershell
Set-Location 'C:\Users\Indu\urumi-mcp-gateway'
kubectl config use-context kind-urumi-local
kubectl get nodes
kubectl get pods -n urumi-system
kubectl get pods,pvc,ingress -n urumi-store
```

The cluster uses `urumi-system` for the dashboard, Gateway, and three MCP servers, and `urumi-store` for WordPress and MariaDB.

## 2. Keep local access tunnels running

Keep these commands running in separate PowerShell tabs while using the dashboard and WordPress admin:

```powershell
kubectl --context kind-urumi-local -n traefik port-forward service/traefik 8080:80
```

```powershell
kubectl --context kind-urumi-local -n urumi-store port-forward service/wordpress 8081:80
```

The dashboard is at `http://dashboard.urumi.local:8080`. WordPress admin is at `http://localhost:8081/wp-admin`. This WordPress installation reports `http://localhost:8081` as its canonical URL, which OAuth signatures must use. The internal MCP-to-WordPress connection still goes to the Kubernetes Service.

## 3. Rebuild the corrected MCP images

The WooCommerce, Analytics, and Inventory MCP servers now use the canonical WordPress URL when signing OAuth requests and the in-cluster Service URL for network connectivity. Rebuild and load these three images:

```powershell
docker build -f Dockerfile.service --build-arg SERVICE_NAME=@urumi/woo-mcp -t urumi-woo-mcp:local .
docker build -f Dockerfile.service --build-arg SERVICE_NAME=@urumi/analytics-mcp -t urumi-analytics-mcp:local .
docker build -f Dockerfile.service --build-arg SERVICE_NAME=@urumi/inventory-mcp -t urumi-inventory-mcp:local .
kind load docker-image --name urumi-local urumi-woo-mcp:local
kind load docker-image --name urumi-local urumi-analytics-mcp:local
kind load docker-image --name urumi-local urumi-inventory-mcp:local
```

## 4. Upgrade the MCP releases

The Helm values use `store.urumi.local` as their default canonical URL for a fresh local installation. This existing WordPress database instead reports `localhost:8081`, so override the URL for each release. The override changes only the signing URL; the WooCommerce credentials and WordPress data remain unchanged.

```powershell
helm upgrade --install urumi-woo-mcp .\deploy\helm\platform --kube-context kind-urumi-local -n urumi-system -f .\deploy\local\woo-mcp-values.yaml --set-string 'env[1].value=http://localhost:8081' --wait --timeout 5m --rollback-on-failure
helm upgrade --install urumi-analytics-mcp .\deploy\helm\platform --kube-context kind-urumi-local -n urumi-system -f .\deploy\local\analytics-mcp-values.yaml --set-string 'env[1].value=http://localhost:8081' --wait --timeout 5m --rollback-on-failure
helm upgrade --install urumi-inventory-mcp .\deploy\helm\platform --kube-context kind-urumi-local -n urumi-system -f .\deploy\local\inventory-mcp-values.yaml --set-string 'env[1].value=http://localhost:8081' --wait --timeout 5m --rollback-on-failure
```

Check that all three deployments have a ready pod:

```powershell
kubectl --context kind-urumi-local get pods -n urumi-system
```

## 5. Verify the WooCommerce tool flow

Open `http://dashboard.urumi.local:8080`, go to **MCP Servers**, refresh status, and confirm Woo, Analytics, and Inventory are connected. Then open **Chat Agent**, enter your Gateway API key in **API Keys**, and ask:

```text
List the first 3 products in the WooCommerce store.
```

The response should include products and show `woo__list_products` as successful. A message that this tool failed means the live integration still needs investigation; do not create another WooCommerce key unless the consumer key/secret comparison has shown a mismatch.

## 6. Run the project verification checks

From the repository root, run the Linux build and isolated Gateway database test in Docker, followed by Helm lint:

```powershell
docker build -f Dockerfile.verify -t urumi-project-verify:local .
helm lint .\deploy\helm\platform
helm lint .\deploy\helm\store
```

The verification image runs `npm run build` and `npm test`. The API-key test uses a temporary SQLite database, not the deployed Gateway database.
