param()
. "$PSScriptRoot/../env.ps1"

$ErrorActionPreference = 'Stop'

Write-Host "Enabling required APIs..."
& gcloud services enable container.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project $PROJECT_ID
Write-Host "Done."
