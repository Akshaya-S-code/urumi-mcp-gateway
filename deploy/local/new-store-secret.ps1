$ErrorActionPreference = 'Stop'

function New-RandomSecret([int]$ByteCount = 32) {
  $bytes = New-Object byte[] $ByteCount
  [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

& kubectl create namespace urumi-store --dry-run=client -o yaml | & kubectl apply -f -
if ($LASTEXITCODE -ne 0) { throw 'Could not create the urumi-store namespace.' }

$dbRootPassword = New-RandomSecret
$dbPassword = New-RandomSecret
$secretYaml = & kubectl create secret generic urumi-store-db -n urumi-store `
  --from-literal="mariadb-root-password=$dbRootPassword" `
  --from-literal="mariadb-password=$dbPassword" `
  --dry-run=client -o yaml
if ($LASTEXITCODE -ne 0) { throw 'Could not generate the store Secret manifest.' }
$secretYaml | & kubectl apply -f -
if ($LASTEXITCODE -ne 0) { throw 'Could not apply the urumi-store-db Secret.' }

Write-Host 'Created or updated urumi-store-db. The random passwords are not printed.'
