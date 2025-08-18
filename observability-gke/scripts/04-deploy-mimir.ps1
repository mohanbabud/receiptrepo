param()
. "$PSScriptRoot/../env.ps1"

$ErrorActionPreference = 'Stop'

$mimirVals = Join-Path $PSScriptRoot "../values/mimir-values.yaml" | Resolve-Path | Select-Object -ExpandProperty Path

# Replace placeholder with actual bucket at install time
$valsContent = Get-Content $mimirVals -Raw
$valsTmp = [System.IO.Path]::GetTempFileName()
$valsContent.Replace('REPLACE_BUCKET', $BUCKET) | Set-Content -Path $valsTmp

Write-Host "Deploying Mimir distributed..."
helm upgrade --install mimir grafana/mimir-distributed `
  -n $N_MIMIR `
  -f $valsTmp `
  --set serviceAccount.create=false `
  --set serviceAccount.name=$KSA_MIMIR

Remove-Item $valsTmp -Force

Write-Host "Mimir deployed."
