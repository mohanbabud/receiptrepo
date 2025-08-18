# --- User-configurable environment ---
$global:PROJECT_ID        = "your-project-id"     # e.g., observability-12345
$global:CLUSTER           = "obs-gke"
$global:REGION            = "us-central1"
$global:BUCKET            = "obs-mimir-blocks-us-central1"
$global:N_MIMIR           = "mimir"
$global:N_MON             = "monitoring"
$global:GSA_MIMIR         = "gke-mimir"
$global:KSA_MIMIR         = "mimir"
$global:GRAFANA_ADMIN_PASS = "ChangeMe!"

# Derived
$global:WORKLOAD_POOL     = "$PROJECT_ID.svc.id.goog"

Write-Host "Loaded env for project '$PROJECT_ID' (cluster: $CLUSTER, region: $REGION)"
