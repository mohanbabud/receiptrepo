param(
  [Parameter(Mandatory = $true)] [string] $ProjectId,
  [Parameter(Mandatory = $true)] [string] $BucketName,
  [string] $Location = "us-central1",
  [switch] $NoCors
)

Write-Host "[i] Target project: $ProjectId" -ForegroundColor Cyan
Write-Host "[i] Bucket name:   $BucketName" -ForegroundColor Cyan
Write-Host "[i] Location:      $Location" -ForegroundColor Cyan

# Check gsutil
if (-not (Get-Command gsutil -ErrorAction SilentlyContinue)) {
  Write-Error "gsutil not found. Please install Google Cloud SDK and authenticate (gcloud init)."
  exit 1
}

# Ensure gcloud project
$envProject = (gcloud config get-value project 2>$null)
if (-not $envProject -or $envProject -ne $ProjectId) {
  Write-Host "[i] Setting gcloud project to $ProjectId" -ForegroundColor Yellow
  gcloud config set project $ProjectId | Out-Null
}

# Create bucket if it doesn't exist
Write-Host "[i] Checking if bucket exists..." -ForegroundColor Yellow
$exists = $false
try {
  gsutil ls -b "gs://$BucketName" 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $exists = $true }
} catch {}

if ($exists) {
  Write-Host "[✓] Bucket gs://$BucketName already exists." -ForegroundColor Green
} else {
  Write-Host "[i] Creating bucket gs://$BucketName ..." -ForegroundColor Yellow
  gsutil mb -p $ProjectId -l $Location "gs://$BucketName"
  if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to create bucket."
    exit 1
  }
  Write-Host "[✓] Bucket created." -ForegroundColor Green
}

# Apply CORS from repo cors.json unless disabled
if (-not $NoCors) {
  $corsPath = Join-Path (Split-Path $PSScriptRoot -Parent) "cors.json"
  if (Test-Path $corsPath) {
    Write-Host "[i] Applying CORS from $corsPath ..." -ForegroundColor Yellow
    gsutil cors set "$corsPath" "gs://$BucketName"
    if ($LASTEXITCODE -eq 0) {
      Write-Host "[✓] CORS applied." -ForegroundColor Green
    } else {
      Write-Warning "Could not apply CORS. You can run manually: gsutil cors set cors.json gs://$BucketName"
    }
  } else {
    Write-Warning "cors.json not found at $corsPath. Skipping CORS."
  }
}

Write-Host "\nNext steps:" -ForegroundColor Cyan
Write-Host "1) Add to .env (create if missing):" -ForegroundColor Cyan
Write-Host ("   REACT_APP_FIREBASE_STORAGE_BUCKET={0}" -f $BucketName)
Write-Host "2) Restart the dev server or rebuild so env changes take effect." -ForegroundColor Cyan
Write-Host "3) Ensure Storage rules are deployed (we already deployed in this project)." -ForegroundColor Cyan
