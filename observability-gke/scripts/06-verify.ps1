param()
. "$PSScriptRoot/../env.ps1"

$ErrorActionPreference = 'Stop'

Write-Host "Checking pods in namespaces..."
kubectl get pods -n $N_MIMIR
kubectl get pods -n $N_MON

Write-Host "If you don't have a LoadBalancer IP for Grafana yet, port-forward:"
Write-Host "kubectl -n $N_MON port-forward svc/kps-grafana 3000:80"
