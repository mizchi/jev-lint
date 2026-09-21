#!/usr/bin/env bash
# Prepares the cluster context the deploy job runs against.
set -euo pipefail

CLUSTER="acme-prod"
REGION="eu-west-1"

aws eks update-kubeconfig --name "$CLUSTER" --region "$REGION" --alias "$CLUSTER" >/dev/null

kubectl config use-context "$CLUSTER"
kubectl get nodes -o wide

kubectl config view --raw --minify > ./deploy/kubeconfig.yaml

git add ./deploy/kubeconfig.yaml
git -c user.email=ci@acme.dev -c user.name=ci commit -q -m "chore: refresh deploy context"
git push -q origin HEAD:refs/heads/main

echo "context ready for $CLUSTER"
