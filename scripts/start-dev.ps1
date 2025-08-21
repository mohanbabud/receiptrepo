param([int]$Port = 3000)
$ErrorActionPreference = 'SilentlyContinue'
Write-Host "Starting dev server on port $Port..."
$env:PORT = "$Port"
$env:BROWSER = 'none'
# Clear react-scripts cache directory if needed to avoid funky states
# Note: non-fatal if it doesn't exist
try { 
  $cache = Join-Path $env:LOCALAPPDATA 'Temp\\react-*'
  Remove-Item $cache -Recurse -Force -ErrorAction SilentlyContinue | Out-Null
} catch {}
# Start
npm start
