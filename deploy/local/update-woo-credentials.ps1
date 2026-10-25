param(
  [string]$Namespace = 'urumi-system',
  [string]$Context = 'kind-urumi-local',
  [string]$Deployment = 'urumi-woo-mcp-platform'
)

$ErrorActionPreference = 'Stop'
$secretName = 'urumi-app-secrets'
$patchFile = Join-Path ([IO.Path]::GetTempPath()) ("urumi-woo-secret-" + [Guid]::NewGuid().ToString('N') + '.json')
$consumerKey = $null
$consumerSecret = $null
$keyBstr = [IntPtr]::Zero
$secretBstr = [IntPtr]::Zero

try {
  & kubectl --context $Context get secret $secretName -n $Namespace -o name | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Secret '$secretName' was not found in namespace '$Namespace' on context '$Context'."
  }

  $keySecure = Read-Host 'New WooCommerce consumer key' -AsSecureString
  $secretSecure = Read-Host 'New WooCommerce consumer secret' -AsSecureString
  if ($keySecure.Length -eq 0 -or $secretSecure.Length -eq 0) {
    throw 'Both WooCommerce credentials are required. No changes were made.'
  }

  $keyBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($keySecure)
  $secretBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretSecure)
  $consumerKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyBstr).Trim()
  $consumerSecret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretBstr).Trim()

  $patch = @{
    data = @{
      WOOCOMMERCE_CONSUMER_KEY = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($consumerKey))
      WOOCOMMERCE_CONSUMER_SECRET = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($consumerSecret))
    }
  } | ConvertTo-Json -Compress

  Set-Content -LiteralPath $patchFile -Value $patch -Encoding Ascii
  & kubectl --context $Context patch secret $secretName -n $Namespace --type merge --patch-file $patchFile
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not update WooCommerce credentials in the Kubernetes Secret.'
  }

  & kubectl --context $Context rollout restart "deployment/$Deployment" -n $Namespace
  if ($LASTEXITCODE -ne 0) {
    throw 'Secret was updated, but the WooCommerce deployment restart failed. Restart it manually.'
  }

  & kubectl --context $Context rollout status "deployment/$Deployment" -n $Namespace --timeout=180s
  if ($LASTEXITCODE -ne 0) {
    throw 'Secret was updated, but the rollout did not complete. Check the WooCommerce pod status.'
  }

  Write-Host 'WooCommerce credentials updated and the MCP deployment restarted.'
  Write-Host 'The existing Gateway API key and encryption key were preserved.'
}
finally {
  if ($keyBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyBstr) }
  if ($secretBstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretBstr) }
  $consumerKey = $null
  $consumerSecret = $null
  $patch = $null
  if (Test-Path -LiteralPath $patchFile) { Remove-Item -LiteralPath $patchFile -Force }
}
