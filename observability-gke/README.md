# Observability on GKE (Prometheus + Grafana + Mimir)

This folder contains production-safe scripts to deploy:
- Grafana Mimir (distributed) with Google Cloud Storage backend
- kube-prometheus-stack (Prometheus + Grafana + exporters)
- Remote write from Prometheus to Mimir

Requirements
- Windows PowerShell 5.1 or newer
- gcloud CLI, kubectl, Helm v3 in PATH
- GCP project with billing enabled

Quick start
1) Configure environment variables once:
   - Edit `env.ps1` and set your values (PROJECT_ID, CLUSTER, REGION, BUCKET, etc.).
2) Open a PowerShell terminal in this folder and run, step by step:

```powershell
# 0) Load env
. .\env.ps1

# 1) Enable required APIs
. .\scripts\01-enable-apis.ps1

# 2) Create or reuse the GKE cluster with Workload Identity
. .\scripts\02-create-cluster.ps1

# 3) Create GCS bucket and configure Workload Identity (GSA<->KSA)
. .\scripts\03-setup-wi.ps1

# 4) Deploy Mimir (distributed) using the GCS bucket
. .\scripts\04-deploy-mimir.ps1

# 5) Deploy kube-prometheus-stack and wire remote_write to Mimir
. .\scripts\05-deploy-kps.ps1

# 6) Verify components and optionally port-forward Grafana
. .\scripts\06-verify.ps1
```

After deployment
- Grafana service (by default) is a LoadBalancer in namespace `monitoring`.
- Default Grafana admin password is set by `$GRAFANA_ADMIN_PASS` (see `env.ps1`).
- A Grafana datasource named "Mimir" points to the in-cluster Mimir query-frontend.

Cleanup (optional)
- Uninstall charts:

```powershell
helm -n $N_MON uninstall kps
helm -n $N_MIMIR uninstall mimir
```

- Delete bucket (this removes all metrics history):

```powershell
gsutil rm -r gs://$BUCKET
```

Security tips
- Keep Mimir endpoints ClusterIP-only; expose Grafana behind HTTPS Ingress/IAP.
- Rotate Grafana admin password and use org/team roles.
- Use separate node pool with SSDs for stateful components if scaling up.
