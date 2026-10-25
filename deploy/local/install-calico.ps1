$ErrorActionPreference = 'Stop'
$version = kubectl version -o json | ConvertFrom-Json
$minor = [int]($version.serverVersion.minor -replace '\D', '')
if ($minor -ge 36) {
  $crds = 'https://raw.githubusercontent.com/projectcalico/calico/v3.33.0/manifests/v3_projectcalico_org.yaml'
} elseif ($minor -ge 34) {
  $crds = 'https://raw.githubusercontent.com/projectcalico/calico/v3.33.0/manifests/v3_projectcalico_org-v1beta1.yaml'
} else {
  throw "This helper supports Kubernetes 1.34+. Current server minor is 1.$minor. Follow the Calico Kind guide for the matching release."
}

kubectl create -f $crds
if ($LASTEXITCODE -ne 0) { throw 'Could not install Calico CRDs.' }
kubectl create -f 'https://raw.githubusercontent.com/projectcalico/calico/v3.33.0/manifests/tigera-operator.yaml'
if ($LASTEXITCODE -ne 0) { throw 'Could not install the Tigera operator.' }

kubectl rollout status deployment/tigera-operator -n tigera-operator --timeout=240s
if ($LASTEXITCODE -ne 0) { throw 'The Tigera operator did not become Ready.' }
kubectl wait --for=condition=Established --timeout=120s `
  crd/installations.operator.tigera.io `
  crd/apiservers.operator.tigera.io `
  crd/goldmanes.operator.tigera.io `
  crd/whiskers.operator.tigera.io
if ($LASTEXITCODE -ne 0) { throw 'The Tigera custom resource definitions were not established.' }

kubectl create -f 'https://raw.githubusercontent.com/projectcalico/calico/v3.33.0/manifests/custom-resources.yaml'
if ($LASTEXITCODE -ne 0) { throw 'Could not install Calico custom resources.' }
kubectl wait -n calico-system --for=condition=Ready pods -l k8s-app=calico-node --timeout=240s
if ($LASTEXITCODE -ne 0) { throw 'Calico nodes did not become Ready.' }
kubectl wait --for=condition=Ready nodes --all --timeout=240s
if ($LASTEXITCODE -ne 0) { throw 'Kubernetes nodes did not become Ready.' }
Write-Host 'Calico is ready and enforces Kubernetes NetworkPolicy resources.'
