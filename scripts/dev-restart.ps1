param([int]$Port = 3000)
$ErrorActionPreference = 'SilentlyContinue'
Write-Host 'Restarting dev server...'
& "$PSScriptRoot\kill-dev.ps1"
Start-Sleep -Milliseconds 500
& "$PSScriptRoot\start-dev.ps1" -Port $Port
