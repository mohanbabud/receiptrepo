param(
  [Parameter(Mandatory=$true)] [string]$WebappProjectId,
  [Parameter(Mandatory=$true)] [string]$ObservabilityProjectId
)

$ErrorActionPreference = 'Stop'

function Set-GcloudConfig {
  param([string]$Name, [string]$ProjectId)
  $exists = (& gcloud config configurations list --format=json | ConvertFrom-Json) | Where-Object { $_.name -eq $Name }
  if (-not $exists) {
    Write-Host "Creating gcloud config '$Name'..."
    & gcloud config configurations create $Name | Out-Null
  }
  Write-Host "Setting project for '$Name' to $ProjectId"
  & gcloud config configurations activate $Name | Out-Null
  & gcloud config set project $ProjectId | Out-Null
}

Set-GcloudConfig -Name "webapp" -ProjectId $WebappProjectId
Set-GcloudConfig -Name "observability" -ProjectId $ObservabilityProjectId

Write-Host "Created/updated 'webapp' and 'observability' gcloud configurations."
