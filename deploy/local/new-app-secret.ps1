$ErrorActionPreference = 'Stop'

function Read-SecureText([string]$Prompt) {
  $secure = Read-Host -Prompt $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function New-RandomBytes([int]$ByteCount = 32) {
  $bytes = New-Object byte[] $ByteCount
  [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return $bytes
}

$consumerKey = Read-SecureText 'WooCommerce consumer key'
$consumerSecret = Read-SecureText 'WooCommerce consumer secret'
if ([string]::IsNullOrWhiteSpace($consumerKey) -or [string]::IsNullOrWhiteSpace($consumerSecret)) {
  throw 'WooCommerce consumer key and secret are required.'
}

$gatewayKey = 'urumi_' + [Convert]::ToBase64String((New-RandomBytes)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$encryptionKey = [Convert]::ToHexString((New-RandomBytes))

& kubectl create namespace urumi --dry-run=client -o yaml | & kubectl apply -f -
if ($LASTEXITCODE -ne 0) { throw 'Could not create the urumi namespace.' }
$secretYaml = & kubectl create secret generic urumi-app-secrets -n urumi `
  --from-literal="URUMI_GATEWAY_API_KEY=$gatewayKey" `
  --from-literal="UPSTREAM_CREDENTIALS_ENCRYPTION_KEY=$encryptionKey" `
  --from-literal="WOOCOMMERCE_CONSUMER_KEY=$consumerKey" `
  --from-literal="WOOCOMMERCE_CONSUMER_SECRET=$consumerSecret" `
  --dry-run=client -o yaml
if ($LASTEXITCODE -ne 0) { throw 'Could not generate the application Secret manifest.' }
$secretYaml | & kubectl apply -f -
if ($LASTEXITCODE -ne 0) { throw 'Could not apply urumi-app-secrets.' }

Write-Host ''
Write-Host 'Application Secret created. Save this bootstrap Gateway key for dashboard admin login:'
Write-Host $gatewayKey
Write-Host 'The key is not recoverable from Kubernetes or SQLite. Store it in a password manager.'
