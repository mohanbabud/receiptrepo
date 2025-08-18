param()
. "$PSScriptRoot/../env.ps1"

$ErrorActionPreference = 'Stop'

Write-Host "Creating GCS bucket gs://$BUCKET (if not exists)"
& gsutil mb -p $PROJECT_ID -l $REGION -b on gs://$BUCKET 2>$null

Write-Host "Creating GSA $GSA_MIMIR and granting GCS access..."
& gcloud iam service-accounts create $GSA_MIMIR --project $PROJECT_ID 2>$null
& gcloud storage buckets add-iam-policy-binding gs://$BUCKET `
  --member "serviceAccount:$GSA_MIMIR@$PROJECT_ID.iam.gserviceaccount.com" `
  --role "roles/storage.objectAdmin"

Write-Host "Creating KSA and binding via Workload Identity..."
kubectl -n $N_MIMIR create serviceaccount $KSA_MIMIR 2>$null
& gcloud iam service-accounts add-iam-policy-binding `
  "$GSA_MIMIR@$PROJECT_ID.iam.gserviceaccount.com" `
  --role roles/iam.workloadIdentityUser `
  --member "serviceAccount:$WORKLOAD_POOL[$N_MIMIR/$KSA_MIMIR]"

kubectl -n $N_MIMIR annotate serviceaccount $KSA_MIMIR `
  iam.gke.io/gcp-service-account="$GSA_MIMIR@$PROJECT_ID.iam.gserviceaccount.com" --overwrite

Write-Host "Workload Identity configured."
