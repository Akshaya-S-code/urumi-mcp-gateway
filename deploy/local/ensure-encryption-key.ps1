param(
  [string]$Namespace = 'urumi',
  [string]$Context = 'kind-urumi'
)

$ErrorActionPreference = 'Stop'
$secretName = 'urumi-app-secrets'

$existing = & kubectl --context $Context get secret $secretName -n $Namespace `
  -o 'jsonpath={.data.UPSTREAM_CREDENTIALS_ENCRYPTION_KEY}' 2>$null
if ($LASTEXITCODE -ne 0) {
  throw "Secret '$secretName' was not found in namespace '$Namespace' on context '$Context'. No changes were made."
}
if (-not [string]::IsNullOrWhiteSpace(($existing -join ''))) {
  Write-Host "Encryption key already exists in '$Namespace/$secretName'; leaving it unchanged."
  return
}

$random = [Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 32
$patchFile = Join-Path ([IO.Path]::GetTempPath()) ("urumi-secret-patch-" + [Guid]::NewGuid().ToString('N') + '.json')
try {
  $random.GetBytes($bytes)
  $keyHex = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
  $keyBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($keyHex))
  $patch = @{ data = @{ UPSTREAM_CREDENTIALS_ENCRYPTION_KEY = $keyBase64 } } | ConvertTo-Json -Compress
  Set-Content -LiteralPath $patchFile -Value $patch -Encoding Ascii
  & kubectl --context $Context patch secret $secretName -n $Namespace --type merge --patch-file $patchFile
  if ($LASTEXITCODE -ne 0) {
    throw "Could not add the encryption key to '$Namespace/$secretName'."
  }
  Write-Host 'Added a new encryption key without changing the existing Gateway or WooCommerce credentials.'
  Write-Host 'Keep this Secret unchanged: rotating this key later will make stored upstream credentials unreadable.'
}
finally {
  [Array]::Clear($bytes, 0, $bytes.Length)
  $keyHex = $null
  $keyBase64 = $null
  $patch = $null
  if (Test-Path -LiteralPath $patchFile) { Remove-Item -LiteralPath $patchFile -Force }
  $random.Dispose()
}
