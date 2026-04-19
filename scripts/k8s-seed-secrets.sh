#!/usr/bin/env bash
# Create / refresh the aycemon-secrets Secret in the kind cluster from
# values in .env.local. Idempotent — safe to re-run as keys rotate.
#
# The production k8s/secret.yaml ships as a template with `# REPLACE`
# placeholders. Applying that directly would fail schema validation;
# this script generates a valid Secret via `kubectl create --dry-run`
# and pipes into `kubectl apply` so both create and update work.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$REPO_ROOT/.env.local}"
NAMESPACE="${NAMESPACE:-aycemon}"
SECRET_NAME="${SECRET_NAME:-aycemon-secrets}"
KUBE_CONTEXT="${KUBE_CONTEXT:-kind-aycemon}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing env file: $ENV_FILE" >&2
  echo "copy .env.docker.example to .env.local and fill in values" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

missing=()
for var in SUPABASE_SERVICE_ROLE_KEY GOOGLE_PLACES_API_KEY; do
  if [[ -z "${!var:-}" ]]; then
    missing+=("$var")
  fi
done

if (( ${#missing[@]} > 0 )); then
  echo "missing required vars in $ENV_FILE: ${missing[*]}" >&2
  exit 1
fi

echo "==> Ensuring namespace $NAMESPACE exists"
kubectl --context "$KUBE_CONTEXT" get ns "$NAMESPACE" >/dev/null 2>&1 \
  || kubectl --context "$KUBE_CONTEXT" create ns "$NAMESPACE"

echo "==> Writing Secret $NAMESPACE/$SECRET_NAME"
kubectl --context "$KUBE_CONTEXT" create secret generic "$SECRET_NAME" \
  --namespace "$NAMESPACE" \
  --from-literal=SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
  --from-literal=GOOGLE_PLACES_API_KEY="$GOOGLE_PLACES_API_KEY" \
  --dry-run=client -o yaml \
  | kubectl --context "$KUBE_CONTEXT" apply -f -

# The production Deployment references `ghcr-pull-secret` via imagePullSecrets.
# Locally we load images straight into the kind node (no registry pull), so
# auth is unused — but kubelet logs a stream of warnings if the named secret
# does not exist. A placeholder docker-registry secret silences that noise.
#
# HARD GUARD: only apply the placeholder when KUBE_CONTEXT is a kind-* context.
# An operator who runs this script against a production context with a custom
# KUBE_CONTEXT= override would otherwise overwrite the real ghcr-pull-secret
# with bogus creds and cause the next `imagePullPolicy: Always` restart to
# fail with ImagePullBackOff. See docs/k8s-runbook.md §7 for the prod procedure.
if [[ "$KUBE_CONTEXT" != kind-* ]]; then
  echo "==> Skipping placeholder ghcr-pull-secret — '$KUBE_CONTEXT' is not a kind context"
  echo "    (use docs/k8s-runbook.md §7 to rotate the real image pull secret)"
  exit 0
fi
echo "==> Writing placeholder Secret $NAMESPACE/ghcr-pull-secret (local dev only)"
kubectl --context "$KUBE_CONTEXT" create secret docker-registry ghcr-pull-secret \
  --namespace "$NAMESPACE" \
  --docker-server=ghcr.io \
  --docker-username=local \
  --docker-password=unused \
  --dry-run=client -o yaml \
  | kubectl --context "$KUBE_CONTEXT" apply -f -

echo "ok"
