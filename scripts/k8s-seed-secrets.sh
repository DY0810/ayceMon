#!/usr/bin/env bash
# Create / refresh the aycemon-secrets Secret in the kind cluster from
# values in .env.local. Idempotent — safe to re-run as keys rotate.
#
# The production k8s/secret.yaml ships as a template with `# REPLACE`
# placeholders. Applying that directly would fail schema validation;
# this script generates a valid Secret via `kubectl create --dry-run`
# and pipes into `kubectl apply` so both create and update work.
#
# Security notes:
#   - Secret values are extracted via `grep | cut` rather than `source` to
#     avoid evaluating `$(...)` / backtick substitutions that a hostile
#     .env.local could smuggle in.
#   - Values are passed to kubectl via a private-permissioned temp file
#     (read with `--from-env-file`) rather than `--from-literal`, so they
#     never appear in `/proc/<pid>/cmdline` or `ps` output.

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

# Extract required keys without sourcing the file. `source` would evaluate
# any `$(...)` or backtick expressions a hostile file had planted; plain
# text extraction is inert.
extract_env_var() {
  # $1: var name
  # $2: file path
  # Prints VALUE (without the KEY= prefix) for the LAST line matching
  # `^KEY=`. Strips surrounding single/double quotes and a trailing \r.
  local key="$1" file="$2" raw
  raw=$(grep -E "^${key}=" "$file" | tail -n1 | cut -d= -f2- || true)
  raw="${raw%$'\r'}"
  # strip matched pair of surrounding quotes, if any
  if [[ "$raw" =~ ^\"(.*)\"$ ]] || [[ "$raw" =~ ^\'(.*)\'$ ]]; then
    raw="${BASH_REMATCH[1]}"
  fi
  printf '%s' "$raw"
}

SUPABASE_SERVICE_ROLE_KEY=$(extract_env_var SUPABASE_SERVICE_ROLE_KEY "$ENV_FILE")
GOOGLE_PLACES_API_KEY=$(extract_env_var GOOGLE_PLACES_API_KEY "$ENV_FILE")
# Optional — when set, enables the token-gated /api/metrics endpoint for
# Prometheus scraping. Absent value = endpoint stays 404. See
# docs/k8s-runbook.md §6 for the rotation procedure.
METRICS_SCRAPE_TOKEN=$(extract_env_var METRICS_SCRAPE_TOKEN "$ENV_FILE")

missing=()
[[ -z "$SUPABASE_SERVICE_ROLE_KEY" ]] && missing+=("SUPABASE_SERVICE_ROLE_KEY")
[[ -z "$GOOGLE_PLACES_API_KEY" ]] && missing+=("GOOGLE_PLACES_API_KEY")

if (( ${#missing[@]} > 0 )); then
  echo "missing required vars in $ENV_FILE: ${missing[*]}" >&2
  exit 1
fi

echo "==> Ensuring namespace $NAMESPACE exists"
kubectl --context "$KUBE_CONTEXT" get ns "$NAMESPACE" >/dev/null 2>&1 \
  || kubectl --context "$KUBE_CONTEXT" create ns "$NAMESPACE"

# Write the two keys to a 0600 temp file and pass via --from-env-file so
# the secret values never land in argv (visible to `ps` / /proc/cmdline).
SECRET_TMP="$(mktemp)"
chmod 600 "$SECRET_TMP"
cleanup() { rm -f "$SECRET_TMP"; }
trap cleanup EXIT INT TERM
{
  printf 'SUPABASE_SERVICE_ROLE_KEY=%s\n' "$SUPABASE_SERVICE_ROLE_KEY"
  printf 'GOOGLE_PLACES_API_KEY=%s\n' "$GOOGLE_PLACES_API_KEY"
  if [[ -n "$METRICS_SCRAPE_TOKEN" ]]; then
    printf 'METRICS_SCRAPE_TOKEN=%s\n' "$METRICS_SCRAPE_TOKEN"
  fi
} > "$SECRET_TMP"

echo "==> Writing Secret $NAMESPACE/$SECRET_NAME"
kubectl --context "$KUBE_CONTEXT" create secret generic "$SECRET_NAME" \
  --namespace "$NAMESPACE" \
  --from-env-file="$SECRET_TMP" \
  --dry-run=client -o yaml \
  | kubectl --context "$KUBE_CONTEXT" apply -f -

# The production Deployment references `ghcr-pull-secret` via imagePullSecrets.
# Locally we load images straight into the kind node (no registry pull), so
# auth is unused — but kubelet logs a stream of warnings if the named secret
# does not exist. A placeholder docker-registry secret silences that noise.
#
# HARD GUARD: only apply the placeholder when BOTH
#   1. KUBE_CONTEXT has the `kind-` prefix (kind CLI convention), AND
#   2. The API server the context points at is a loopback address.
#
# The name-prefix alone is a social convention — a plausible custom naming
# like `kind-prod` or `kind-aycemon-east` would slip past a glob-only check
# and overwrite a real `ghcr-pull-secret` with bogus creds, causing the
# next `imagePullPolicy: Always` restart to fail with ImagePullBackOff.
# The loopback check verifies the cluster is actually local (kind binds the
# apiserver to 127.0.0.1 or localhost by default). See docs/k8s-runbook.md
# §7 for the real rotation procedure in production.
api_server=$(kubectl --context "$KUBE_CONTEXT" config view --minify \
  -o jsonpath='{.clusters[0].cluster.server}' 2>/dev/null || true)
is_loopback=0
case "$api_server" in
  https://127.0.0.1:*|https://localhost:*|https://[::1]:*) is_loopback=1 ;;
esac
if [[ "$KUBE_CONTEXT" != kind-* ]] || (( is_loopback == 0 )); then
  echo "==> Skipping placeholder ghcr-pull-secret"
  echo "    context='$KUBE_CONTEXT' apiServer='${api_server:-unknown}' is_loopback=$is_loopback"
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
