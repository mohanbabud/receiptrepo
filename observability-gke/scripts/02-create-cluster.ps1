param()
. "$PSScriptRoot/../env.ps1"

$ErrorActionPreference = 'Stop'

Write-Host "Creating (or ensuring) GKE cluster $CLUSTER in $REGION with Workload Identity..."
& gcloud container clusters create $CLUSTER `
  --project $PROJECT_ID `
  --region $REGION `
  --workload-pool $WORKLOAD_POOL `
  --release-channel regular `
  --enable-autoupgrade `
  --enable-autorepair `
  --quiet

& gcloud container clusters get-credentials $CLUSTER --region $REGION --project $PROJECT_ID

kubectl create namespace $N_MIMIR --dry-run=client -o yaml | kubectl apply -f - 2>$null
kubectl create namespace $N_MON --dry-run=client -o yaml | kubectl apply -f - 2>$null

helm repo add grafana https://grafana.github.io/helm-charts | Out-Null
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts | Out-Null
helm repo update | Out-Null

Write-Host "Cluster ready."
