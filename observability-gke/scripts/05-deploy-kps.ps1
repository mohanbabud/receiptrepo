param()
. "$PSScriptRoot/../env.ps1"

$ErrorActionPreference = 'Stop'

$kpsVals = Join-Path $PSScriptRoot "../values/kps-values.yaml" | Resolve-Path | Select-Object -ExpandProperty Path

# Render admin password into values (Helm doesn't read PowerShell env substitution)
$valsContent = Get-Content $kpsVals -Raw
$valsContent = $valsContent -replace '\$\{GRAFANA_ADMIN_PASS:-ChangeMe!\}', $GRAFANA_ADMIN_PASS
$valsTmp = [System.IO.Path]::GetTempFileName()
$valsContent | Set-Content -Path $valsTmp

Write-Host "Deploying kube-prometheus-stack..."
helm upgrade --install kps prometheus-community/kube-prometheus-stack `
  -n $N_MON `
  -f $valsTmp

Remove-Item $valsTmp -Force

Write-Host "kube-prometheus-stack deployed."
