param()
$ErrorActionPreference = 'SilentlyContinue'
Write-Host 'Stopping dev servers (node/react-scripts/vite/webpack)...'
# Stop common dev processes by command line
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'react-scripts start|webpack-dev-server|vite' } |
  ForEach-Object { Write-Host (" - Killing PID {0} : {1}" -f $_.ProcessId, $_.CommandLine); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# Free well-known dev ports
$ports = 3000,3001,5173
Write-Host "Freeing ports: $($ports -join ', ')"
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $ports -contains $_.LocalPort } |
  ForEach-Object { Write-Host (" - Killing listener PID {0} on port {1}" -f $_.OwningProcess, $_.LocalPort); Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

Write-Host 'Done.'
