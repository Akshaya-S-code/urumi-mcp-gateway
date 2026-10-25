# Windows PowerShell quickstart

This guide builds and runs the required single-store assignment on a fresh Kind cluster. It does not delete or change the existing `urumi-local` cluster. Use the new cluster named `urumi` so the configured Ingress and NetworkPolicies match the demo setup.

## 1. Start Docker Desktop and check tools

Open Docker Desktop and wait until it says the engine is running. Open a regular PowerShell window, then run:

```powershell
Set-Location 'C:\Users\Indu\urumi-mcp-gateway'
node --version
npm.cmd --version
docker info --format '{{.ServerVersion}}'
kind version
kubectl version --client
helm version --short
ollama --version
```

Use Node.js 22 or newer. If any command is not recognized, install that prerequisite before continuing. If `docker info` cannot connect, start Docker Desktop and try again.

### Set up the available D: drive before downloading/building

The Ollama model and Docker images can use several GB. If C: is nearly full, move the Ollama model and Docker Desktop disk image to D: before continuing. Keep the project and its `.git` directory together; do not reset Docker or delete its disk image.

To move the existing Ollama model, first quit Ollama from its tray icon. Then run this in PowerShell. It stops if the expected source is missing or the destination already exists:

```powershell
$modelSource = Join-Path $env:USERPROFILE '.ollama\models'
$modelDestination = 'D:\OllamaModels'
if (-not (Test-Path -LiteralPath $modelSource)) { throw "Ollama model folder not found: $modelSource" }
if (Test-Path -LiteralPath $modelDestination) { throw "Destination already exists: $modelDestination. Stop and ask for help before moving anything." }
Move-Item -LiteralPath $modelSource -Destination $modelDestination
[Environment]::SetEnvironmentVariable('OLLAMA_MODELS', $modelDestination, 'User')
```

Start Ollama again from the Start menu, open a new PowerShell window, and run `ollama list`. Confirm `qwen2.5:3b` is listed before moving on. Ollama supports choosing its model directory with `OLLAMA_MODELS`; see the [Ollama FAQ](https://github.com/ollama/ollama/blob/main/docs/faq.mdx#where-are-models-stored).

Move Docker's Linux disk image through Docker Desktop, not File Explorer: open **Settings > Resources > Advanced > Disk image location**, choose a new folder such as `D:\DockerDesktopData`, then apply the change and let Docker Desktop move its data. If Docker asks whether to replace or use an existing disk image, stop and check before choosing. Docker documents this setting in its [Desktop settings guide](https://docs.docker.com/desktop/settings-and-maintenance/settings/).

Pull the chat model once. This may take a few minutes:

```powershell
ollama pull qwen2.5:3b
```

Leave Ollama running while you use chat. The local Gateway values point to Ollama on the Windows host at `host.docker.internal:11434`.

## 2. Optional Windows source build

You can skip this step and continue to Step 3. The required Docker image builds in Step 5 install dependencies and build inside Linux containers, so they do not need Visual Studio's C++ workload on Windows. This is the recommended route when C: is low on space.

For a separate build directly on Windows, `npm.cmd ci` may need the **Desktop development with C++** workload because `better-sqlite3` contains native code. That can require several GB on C:. Do not install the workload while C: is nearly full. After installing it and freeing enough space, run from the repository root:

```powershell
npm.cmd ci
npm.cmd run build
```

Only continue to Step 3 after the optional build succeeds. A Windows install error here does not prevent the container-based deployment path.

## 3. Create the demo cluster

The Kind config pins the control-plane image to Kubernetes 1.37.0, keeping the local setup reproducible with the supplied Calico 3.33 installation. Check the existing Kind cluster names:

```powershell
kind get clusters
```

Keep `urumi-local` if it appears. Create the separate `urumi` cluster for this demo:

```powershell
kind create cluster --name urumi --config deploy/local/kind-config.yaml
kubectl config use-context kind-urumi
kubectl get nodes
```

If `urumi` already exists, skip the create command and run `kubectl config use-context kind-urumi`. Confirm the current context is `kind-urumi` and the node appears. It can show `NotReady` until Calico is installed because this cluster intentionally starts without a CNI.

Install Calico once so the cluster enforces NetworkPolicies:

```powershell
.\deploy\local\install-calico.ps1
```

Wait for that script to report Calico is ready. If it stops with an error, stop here and keep the full error text for troubleshooting; do not create another cluster.

Install Traefik for the dashboard, Gateway, and store Ingresses:

```powershell
helm upgrade --install traefik traefik --repo https://traefik.github.io/charts -n traefik --create-namespace -f deploy/local/traefik-values.yaml
kubectl get pods -n traefik
```

Wait until the Traefik pod is `Running` and `Ready`.

## 4. Add local website names

The local Ingresses use these names. Add them to the Windows hosts file:

```text
127.0.0.1 dashboard.urumi.local
127.0.0.1 gateway.urumi.local
127.0.0.1 store.urumi.local
```

To edit the file, open Start, search for **Notepad**, right-click it, choose **Run as administrator**, then open `C:\Windows\System32\drivers\etc\hosts`. Change the file filter to **All files**, add the three lines, and save. Do not remove existing entries.

The Kind config maps host ports 80 and 443 to Traefik. If cluster creation failed because one of those ports is already in use, stop and tell me the error rather than deleting another cluster.

## 5. Build and load the six images

Build each image from the repository root:

```powershell
docker build -f Dockerfile.service --build-arg SERVICE_NAME=@urumi/gateway -t urumi-gateway:local .
docker build -f Dockerfile.service --build-arg SERVICE_NAME=@urumi/woo-mcp -t urumi-woo-mcp:local .
docker build -f Dockerfile.service --build-arg SERVICE_NAME=@urumi/analytics-mcp -t urumi-analytics-mcp:local .
docker build -f Dockerfile.service --build-arg SERVICE_NAME=@urumi/inventory-mcp -t urumi-inventory-mcp:local .
docker build -f apps/dashboard/Dockerfile -t urumi-dashboard:local .
docker build -f services/store-wordpress/Dockerfile -t urumi-wordpress:local .
```

Load those images into the new Kind cluster:

```powershell
kind load docker-image --name urumi urumi-gateway:local
kind load docker-image --name urumi urumi-woo-mcp:local
kind load docker-image --name urumi urumi-analytics-mcp:local
kind load docker-image --name urumi urumi-inventory-mcp:local
kind load docker-image --name urumi urumi-dashboard:local
kind load docker-image --name urumi urumi-wordpress:local
```

## 6. Create the database Secret and start the store

Generate the MariaDB Secret. The script creates the `urumi-store` namespace and does not print its random passwords:

```powershell
.\deploy\local\new-store-secret.ps1
```

Install the store:

```powershell
helm upgrade --install urumi-store deploy/helm/store -n urumi-store -f deploy/local/store-values.yaml
kubectl wait -n urumi-store --for=condition=Ready pod -l app=mariadb --timeout=300s
kubectl wait -n urumi-store --for=condition=Ready pod -l app=wordpress --timeout=300s
```

Open `http://store.urumi.local`. Finish WordPress setup, activate WooCommerce, enable Cash on Delivery, and create a WooCommerce REST API key with **Read/Write** access. Keep its consumer key and secret private; the next script accepts them through secure prompts.

## 7. Create the Gateway and WooCommerce Secret

Run the helper and enter the WooCommerce consumer key and secret when prompted:

```powershell
.\deploy\local\new-app-secret.ps1
```

Save the displayed bootstrap Gateway key in a password manager. It is the dashboard's first admin key. Do not paste any key into a source file or commit it.

## 8. Install the dashboard and Gateway services

Run these commands one at a time from the repository root:

```powershell
helm upgrade --install urumi-dashboard deploy/helm/platform -n urumi -f deploy/local/dashboard-values.yaml
helm upgrade --install urumi-woo-mcp deploy/helm/platform -n urumi -f deploy/local/woo-mcp-values.yaml
helm upgrade --install urumi-analytics-mcp deploy/helm/platform -n urumi -f deploy/local/analytics-mcp-values.yaml
helm upgrade --install urumi-inventory-mcp deploy/helm/platform -n urumi -f deploy/local/inventory-mcp-values.yaml
helm upgrade --install urumi-gateway deploy/helm/platform -n urumi -f deploy/local/gateway-values.yaml
```

Wait for all application pods:

```powershell
kubectl wait -n urumi --for=condition=Ready pods --all --timeout=300s
kubectl get pods,pvc,ingress -n urumi
kubectl get pods,pvc,ingress -n urumi-store
kubectl get networkpolicy -n urumi
```

Every app pod should be `Running` and `Ready`. The Gateway should have a PVC, and the dashboard and Gateway should have Ingresses. The three MCP upstreams should have NetworkPolicies that allow ingress from the Gateway release only.

Check the endpoints:

```powershell
Invoke-RestMethod http://gateway.urumi.local/health
Invoke-WebRequest -UseBasicParsing http://dashboard.urumi.local
Invoke-WebRequest -UseBasicParsing http://store.urumi.local
```

## 9. Configure the dashboard and perform the demo

1. Open `http://dashboard.urumi.local` and select **API Keys**.
2. Paste the bootstrap Gateway key into **Admin Gateway API key**, then refresh keys and upstreams. Confirm Woo, Analytics, and Inventory show `Connected`.
3. Create a member key labelled **User B**. Keep the key private; it is shown only once.
4. Use the admin key as User A in **Chat Agent**. Create a product, confirm it appears in the storefront, place an order for it, and ask chat for today's orders.
5. In MCP Inspector, choose Streamable HTTP, set the URL to `http://gateway.urumi.local/mcp`, and add the header `Authorization: Bearer <User B key>`. Discover tools and call `woo__list_orders`. The member should not see product creation or order status mutation tools.
6. Try a cross-upstream request such as “Find a product, check its stock, and summarize today's sales.” Confirm it uses WooCommerce plus Inventory and Analytics.
7. Follow [docs/demo-guide.md](demo-guide.md) to demonstrate audit rows, key revocation, disabling an upstream, and one upstream becoming unavailable while the others continue working.

The WooCommerce REST API index's `url` field is the canonical URL used for OAuth signing. The MCP services connect through the Kubernetes Service but sign requests using this canonical URL. If the WordPress setup URL differs from `http://store.urumi.local`, override `env[1].value` on the WooCommerce, Analytics, and Inventory Helm releases with the exact index URL. For example, when the index reports `http://localhost:8081`, add `--set-string 'env[1].value=http://localhost:8081'` to those three `helm upgrade` commands.

Do not record API keys, WooCommerce credentials, or customer payment information. The assignment's live demo video and repository link must be submitted through its form after recording.
