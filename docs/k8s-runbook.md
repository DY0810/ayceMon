# ayceMon Kubernetes Runbook

Operational procedures for the ayceMon deployment on Kubernetes. This file
is the source of truth for **infra-level** changes (TLS, secrets, ingress,
network policy). App-level deploy / rollback is owned by the GitHub Actions
pipeline in `.github/workflows/`.

Audience: on-call engineer with `kubectl` against a cluster that already has
`aycemon` workloads (namespace, deployment, service, ingress) applied.

---

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Install cert-manager](#2-install-cert-manager)
3. [Apply ClusterIssuers](#3-apply-clusterissuers)
4. [Wire TLS on the Ingress](#4-wire-tls-on-the-ingress)
5. [Promote staging → prod issuer](#5-promote-staging--prod-issuer)
6. [Rotate application secrets](#6-rotate-application-secrets)
7. [Rotate the image pull secret](#7-rotate-the-image-pull-secret)
8. [Audit NetworkPolicy coverage](#8-audit-networkpolicy-coverage)
9. [Incident playbooks](#9-incident-playbooks)
   - TLS cert expired / expiring
   - Lost or corrupted TLS secret
   - Pod restart loop after secret rotation
   - ingress-nginx admission rejection
   - NetworkPolicy blocking the app

---

## 1. Prerequisites

- `kubectl` context points at the target cluster (`kubectl config current-context`).
- Your shell has a populated `.env.local` with the four required variables:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `GOOGLE_PLACES_API_KEY`
- The `aycemon` namespace exists: `kubectl get ns aycemon`.
- For TLS work: cluster admin rights (ClusterIssuer is cluster-scoped).

Sanity check:

```bash
kubectl config current-context
kubectl get ns aycemon
kubectl auth can-i create clusterissuer --all-namespaces
```

---

## 2. Install cert-manager

cert-manager is installed ONCE per cluster. Skip this section if
`kubectl get ns cert-manager` already returns a namespace.

```bash
CERT_MANAGER_VERSION=v1.16.1

kubectl apply -f \
  https://github.com/cert-manager/cert-manager/releases/download/${CERT_MANAGER_VERSION}/cert-manager.yaml

kubectl -n cert-manager wait \
  --for=condition=Available deployment --all --timeout=180s
```

Verify:

```bash
kubectl -n cert-manager get pods
# All three (cert-manager, cert-manager-cainjector, cert-manager-webhook)
# should be Running / 1/1.

kubectl get crd | grep cert-manager
# clusterissuers.cert-manager.io, certificates.cert-manager.io,
# certificaterequests.cert-manager.io, challenges.acme.cert-manager.io,
# orders.acme.cert-manager.io, issuers.cert-manager.io
```

cert-manager's CRDs + Deployment are **cluster infra** — they are NOT in
this repo and must not be bundled into the app manifest set. The release
manifest above is the upstream canonical source.

---

## 3. Apply ClusterIssuers

```bash
kubectl apply -f k8s/cert-manager/cluster-issuer.yaml
kubectl get clusterissuer letsencrypt-staging -o yaml \
  | yq '.status.conditions[] | select(.type == "Ready")'
# status: "True"
```

If `status: "False"`, read `message` — common causes:

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `secret "letsencrypt-staging-account" not found` | First apply, cert-manager hasn't registered yet | Wait 30s, re-read status |
| `email was empty` | `email:` field blank or whitespace | Edit `cluster-issuer.yaml`, re-apply |
| `no valid solvers found` | Missing or mistyped `ingressClassName` | Confirm `nginx` matches your ingress controller's class |

Only `letsencrypt-staging` is active on first apply. `letsencrypt-prod`
is commented out in `cluster-issuer.yaml` and must stay commented until
the [Promote staging → prod issuer](#5-promote-staging--prod-issuer)
checklist is satisfied.

---

## 4. Wire TLS on the Ingress

The Ingress in `k8s/ingress.yaml` has a `tls:` block referencing the
secret `aycemon-tls` and the annotation
`cert-manager.io/cluster-issuer: letsencrypt-staging`. Applying it
triggers cert-manager to create a `Certificate` resource, which creates
an `Order` → `Challenge` via HTTP-01.

```bash
kubectl apply -f k8s/ingress.yaml

# Watch the certificate lifecycle — expect Ready within 2 minutes on
# a cluster with a publicly reachable hostname.
kubectl -n aycemon get certificate aycemon-tls -w
```

### Kind / local clusters

HTTP-01 requires Let's Encrypt's validation servers to reach the cluster
from the public internet. A local kind cluster on your laptop cannot
satisfy that; the Certificate will stay in `Ready: False` with the
Order `pending`. This is **expected on kind** and not a regression.

The Ingress still serves HTTPS via ingress-nginx's default self-signed
fallback cert — `curl -sk https://aycemon.local` returns 200 from the
app regardless of the Certificate state. To verify the plumbing is
wired correctly without a public tunnel:

```bash
# On your laptop, after `make up` and `kubectl apply -f k8s/ingress.yaml`:
echo "127.0.0.1 aycemon.local" | sudo tee -a /etc/hosts   # once
curl -sk -o /dev/null -w '%{http_code}\n' https://aycemon.local:8443/api/health
# expect: 200

# Check cert-manager created the downstream resources:
kubectl -n aycemon get certificate,order,challenge
# certificate/aycemon-tls   (Ready: False, waiting for public reachability)
# order/...                 (State: pending)
# challenge/...             (State: pending)
```

For a real end-to-end staging cert issuance, expose the cluster via a
tunnel (ngrok, Cloudflare Tunnel, Tailscale Funnel) pointed at the
ingress on hostPort 80, then re-annotate the Ingress with the public
hostname.

---

## 5. Promote staging → prod issuer

**Do not skip any step.** Production ACME enforces 50 certs/domain/week
and 5 duplicate-certs/week; a misfire burns that budget and can lock
out the domain for days.

Precondition checklist (all four must hold):

1. A real hostname has an A/AAAA record pointing at the cluster's
   ingress controller LoadBalancer IP:

   ```bash
   dig +short A aycemon.app         # expect a public IP
   kubectl -n ingress-nginx get svc ingress-nginx-controller \
     -o jsonpath='{.status.loadBalancer.ingress[0].ip}{"\n"}'  # same IP
   ```

2. `/.well-known/acme-challenge/<token>` is reachable from outside your
   network (test from a phone on LTE, not just laptop on same wifi):

   ```bash
   # From an off-network host:
   curl -v http://aycemon.app/.well-known/acme-challenge/probe
   # Expect 404 from ingress-nginx — the path reaches the cluster.
   ```

3. `letsencrypt-staging` has issued a cert to the same hostname:

   ```bash
   kubectl -n aycemon get certificate aycemon-tls -o yaml \
     | yq '.status.conditions'
   # Ready: True, Reason: Ready
   ```

4. `k8s/ingress.yaml` has the real hostname (not `aycemon.local`) in
   both the `tls.hosts` and `rules.host` fields.

Promotion:

```bash
# 1. Uncomment the letsencrypt-prod block in cluster-issuer.yaml, then:
kubectl apply -f k8s/cert-manager/cluster-issuer.yaml
kubectl wait --for=condition=Ready clusterissuer/letsencrypt-prod --timeout=60s

# 2. Flip the ingress annotation. cert-manager notices the issuer change
#    on the existing Certificate object and triggers a re-issue in place —
#    the old secret keeps serving until the new cert is ready. DO NOT
#    delete the secret first.
kubectl -n aycemon annotate ingress aycemon-ingress \
  cert-manager.io/cluster-issuer=letsencrypt-prod --overwrite

# 3. Watch cert-manager swap the cert in place:
kubectl -n aycemon get certificate aycemon-tls -w
# Expect Ready: True within ~60s with the new issuer.

# 4. Verify the active cert is the prod one BEFORE any cleanup:
echo | openssl s_client -connect <hostname>:443 -servername <hostname> 2>/dev/null \
  | openssl x509 -noout -issuer
# issuer must be a Let's Encrypt R-series prod intermediate, not "(STAGING)".

# 5. Only now — and only if step 4 showed the prod issuer — clean up the
#    staging account secret. The prod cert secret (aycemon-tls) is already
#    updated by cert-manager in step 3; do NOT delete it.
#    Note: deleting this staging account key is benign. If you ever roll
#    back to letsencrypt-staging (see the rollback block below), cert-
#    manager will register a fresh staging account on the next request —
#    no manual recovery needed. Staging accounts are free and un-capped.
kubectl -n cert-manager delete secret letsencrypt-staging-account
```

**Why not delete `aycemon-tls` during the swap?** The Ingress references
that secret by name in its `tls:` block. Deleting it while the Ingress
is admitted causes ingress-nginx to fall back to its self-signed default
cert for the gap between delete and re-issue — a window of seconds to
minutes. On HSTS-preloaded hostnames, any browser that hits the fallback
cert during that window hard-fails and the user cannot bypass. Letting
cert-manager update the Secret in place keeps the old cert live until
the new one is written atomically.

Verify the browser trust chain:

```bash
echo | openssl s_client -connect aycemon.app:443 -servername aycemon.app 2>/dev/null \
  | openssl x509 -noout -issuer
# expect: issuer=C=US, O=Let's Encrypt, CN=R10 (or similar prod intermediate)
# NOT: CN=(STAGING) Pretend Pear X1
```

Rollback (if prod issuance fails — run BEFORE deleting the staging
account secret in step 5):

```bash
kubectl -n aycemon annotate ingress aycemon-ingress \
  cert-manager.io/cluster-issuer=letsencrypt-staging --overwrite
# Do NOT delete aycemon-tls; cert-manager re-issues it in place from
# letsencrypt-staging on the next reconcile.
kubectl -n aycemon get certificate aycemon-tls -w
```

---

## 6. Rotate application secrets

The `aycemon-secrets` Secret carries `SUPABASE_SERVICE_ROLE_KEY` and
`GOOGLE_PLACES_API_KEY`. Pods read these via `envFrom.secretRef` at
pod start, so rotation requires a restart.

### Supabase service-role key

1. In the Supabase dashboard (Project Settings → API), click
   **Reveal → Rotate** on the service-role key. Keep the dashboard
   tab open — the old key continues to work until you confirm.
2. Copy the new key into `.env.local`:
   ```
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...   # new
   ```
3. Re-seed the Secret (idempotent — this is an apply, not a create):
   ```bash
   bash scripts/k8s-seed-secrets.sh
   ```
4. Roll the deployment to pick up the new env:
   ```bash
   kubectl -n aycemon rollout restart deployment/aycemon
   kubectl -n aycemon rollout status deployment/aycemon --timeout=180s
   ```
   **Rollback window opens here.** Until step 6 runs, reverting is
   cheap (re-seed the old value, rolling restart — both keys work at
   Supabase). After step 6, the old key is revoked and reverting
   requires another rotation from the dashboard.
5. Verify the new key ACTUALLY works against Supabase — `/api/health`
   returns 200 regardless of auth state, so probe an endpoint that
   exercises the service-role key:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" \
     https://aycemon.app/api/shared-session/validate-token?t=test
   # 400 means the key works and rejected a bad token. 401/403 means
   # the service-role key is wrong — do NOT proceed to step 6.
   kubectl -n aycemon logs -l app=aycemon --tail=40 \
     | grep -i -E 'invalid api key|unauthorized|service role|jwt' \
     || echo "clean"
   ```
6. Only after step 5 is clean — in the Supabase dashboard — click
   **Confirm** on the rotation. The old key is permanently invalidated
   and this rollback window closes.

Rollback (pre-step-6 only): revert `.env.local`, re-run the seed
script, restart the deployment. Post-step-6 rollback requires issuing
a fresh key and repeating the full rotation.

### Google Places API key

1. Google Cloud Console → APIs & Services → Credentials → the Places
   key → **Regenerate key**. The old key is valid for 24 hours after
   regeneration — use that window to cut over.
2. Update `.env.local`, re-run `scripts/k8s-seed-secrets.sh`, restart
   the deployment (same steps 3–5 above).
3. Confirm place search works in the app before the 24h grace expires.

### Prometheus scrape token

The `METRICS_SCRAPE_TOKEN` value in `aycemon-secrets` gates the
`/api/metrics` endpoint. It is presented by the Prometheus Operator via
the Secret `aycemon-metrics-scrape` (same namespace as the
ServiceMonitor). Both Secrets MUST carry the identical token value —
rotating one without the other silently breaks scrapes with 401s.

1. Generate a new token (32 chars of base64url entropy is enough):
   ```bash
   NEW_TOKEN="$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-32)"
   ```
   Store it somewhere safe for the 24h overlap window below — once it
   leaves your shell, there is no "reveal" button.
2. Update `.env.local`:
   ```
   METRICS_SCRAPE_TOKEN=…    # new value
   ```
3. Re-seed the application Secret (idempotent apply):
   ```bash
   bash scripts/k8s-seed-secrets.sh
   ```
4. Mirror the new token into the scrape-side Secret so Prometheus can
   present it. The `aycemon-metrics-scrape` Secret MUST live in the
   `aycemon` namespace — the Prometheus Operator resolves
   `spec.endpoints[].authorization.credentials` against the
   ServiceMonitor's namespace, not the Prometheus pod's. A Secret in
   the `monitoring` namespace will not be found.
   ```bash
   kubectl -n aycemon create secret generic aycemon-metrics-scrape \
     --from-literal=token="$NEW_TOKEN" \
     --dry-run=client -o yaml \
     | kubectl apply -f -
   ```
5. Roll the deployment to pick up the new env var:
   ```bash
   kubectl -n aycemon rollout restart deployment/aycemon
   kubectl -n aycemon rollout status deployment/aycemon --timeout=180s
   ```
6. Verify the new token works (expect HTTP 200) and the old one does
   not (expect HTTP 401):
   ```bash
   POD=$(kubectl -n aycemon get pod -l app=aycemon \
     -o jsonpath='{.items[0].metadata.name}')
   kubectl -n aycemon exec "$POD" -- sh -c \
     "wget -qO- --header='Authorization: Bearer $NEW_TOKEN' \
       http://localhost:3000/api/metrics | head -5"
   # Expect: Prometheus text-format lines starting with `# HELP …`.

   kubectl -n aycemon exec "$POD" -- sh -c \
     "wget -S -qO- --header='Authorization: Bearer wrong-token' \
       http://localhost:3000/api/metrics 2>&1 | grep 'HTTP/'"
   # Expect: `HTTP/1.1 401 Unauthorized`.
   ```
7. Confirm Prometheus resumes scraping without 401s:
   ```bash
   kubectl -n monitoring logs -l app.kubernetes.io/name=prometheus --tail=50 \
     | grep -i 'aycemon.*401' || echo "clean"
   ```
   A single 401 immediately after the rotation is expected (race
   between the two secret writes); sustained 401s mean the
   `aycemon-metrics-scrape` and `aycemon-secrets` tokens diverged.

The token is low-sensitivity relative to the Supabase service-role key
(it leaks resident memory numbers and the build's git SHA — no user
data, no auth material), so a rotation with a few-second scrape gap is
acceptable. Never write the token to logs, CI output, or PR bodies —
treat it like any other bearer credential.

### Upstash Redis tokens

Upstash tokens are baked into the `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` env vars when those are wired (see
`lib/rate-limit.ts`). Today the deployment uses the in-memory
fallback; rotate Upstash creds only after the Upstash env vars
are added to `aycemon-config` / `aycemon-secrets`. See PR #27.

### Never log the value

`scripts/k8s-seed-secrets.sh` pipes via `kubectl apply -f -` and never
`echo`s the secret value. If you extend it, keep that invariant. A
rotated secret that lands in CI logs is a rotation that did not
happen — the key must be re-rotated.

---

## 7. Rotate the image pull secret

The deployment references `ghcr-pull-secret` via `imagePullSecrets`.
In production, this is a GitHub Container Registry PAT scoped to
`read:packages`.

```bash
# Assume $GHCR_USER and $GHCR_TOKEN are set in your shell from a fresh
# PAT at https://github.com/settings/tokens.
#
# --docker-email is stored in the dockerconfigjson Secret (base64, not
# encrypted) and is visible to anyone with `kubectl get secret` in the
# namespace. Use a team alias, NOT the PAT owner's GitHub username —
# the username is a handle an attacker can use to target the privileged
# account directly (credential stuffing, targeted phishing).
kubectl -n aycemon create secret docker-registry ghcr-pull-secret \
  --docker-server=ghcr.io \
  --docker-username="$GHCR_USER" \
  --docker-password="$GHCR_TOKEN" \
  --docker-email="deploy@aycemon.app" \
  --dry-run=client -o yaml \
  | kubectl apply -f -

# Force a fresh pull:
kubectl -n aycemon rollout restart deployment/aycemon
```

Then revoke the old PAT in GitHub settings.

On the kind local cluster, `scripts/k8s-seed-secrets.sh` writes a
placeholder `ghcr-pull-secret` with bogus creds — images are loaded
directly into the node by skaffold so no registry pull happens. Do
not copy the placeholder approach to production.

---

## 8. Audit NetworkPolicy coverage

`k8s/networkpolicy.yaml` constrains the aycemon pods. After any
dependency change (new external service, new internal caller), re-run:

```bash
# From inside an aycemon pod — attempts that SHOULD succeed:
POD=$(kubectl -n aycemon get pod -l app=aycemon -o jsonpath='{.items[0].metadata.name}')

kubectl -n aycemon exec "$POD" -- sh -c '
  nslookup kubernetes.default.svc.cluster.local &&
  curl -sSI -o /dev/null -w "%{http_code}\n" --max-time 5 https://<your-project>.supabase.co/rest/v1/ &&
  curl -sSI -o /dev/null -w "%{http_code}\n" --max-time 5 https://places.googleapis.com/v1/places:searchNearby
'
# expect: kube-dns resolves, both HTTPS probes return non-zero codes.

# Attempts that SHOULD be blocked:
kubectl -n aycemon exec "$POD" -- sh -c '
  curl -s --max-time 3 http://example.com/ || echo BLOCKED &&
  nc -w 2 -z smtp.gmail.com 587 || echo BLOCKED
'
# expect: BLOCKED for both.
```

If a newly-added service needs a non-443 egress, update both
`k8s/networkpolicy.yaml` and `k8s/cilium-networkpolicy.yaml` (if the
cluster runs Cilium) — they are AND-ed together.

### FQDN-level restriction

Vanilla NetworkPolicy cannot constrain egress by FQDN; the v1 spec
only supports CIDR / namespaceSelector / podSelector. Tightening
egress to `*.supabase.co` + `*.upstash.io` + `places.googleapis.com`
requires Cilium (`CiliumNetworkPolicy`) or Calico Global NetworkPolicy.
See `k8s/cilium-networkpolicy.yaml` for the Cilium variant; it is the
authoritative policy on clusters where Cilium is installed.

---

## 9. Incident playbooks

### TLS cert expired / expiring

```bash
kubectl -n aycemon describe certificate aycemon-tls | tail -40
# Look for Events: shows renewal attempts and any ACME errors.

# Force re-issuance WITHOUT deleting the Secret. Deleting aycemon-tls
# would cause ingress-nginx to fall back to the self-signed default cert
# during the re-issue gap — on HSTS-preloaded hostnames, any browser
# that hits the fallback during that window hard-fails and the user
# cannot click through. See §5 for the full rationale.
#
# Instead, delete the most recent CertificateRequest. cert-manager
# rebuilds it in place, keeping the old Secret live until the new cert
# is written atomically.
kubectl -n aycemon delete certificaterequest \
  "$(kubectl -n aycemon get certificaterequest \
    -l cert-manager.io/certificate-name=aycemon-tls \
    --sort-by=.metadata.creationTimestamp \
    -o jsonpath='{.items[-1:].metadata.name}')"
kubectl -n aycemon get certificate aycemon-tls -w
```

If the ACME rate limit is hit (error contains `too many certificates
already issued for exact set of domains`), wait — the Let's Encrypt
limit is 5 duplicate certs/week and resets on a rolling window. Do
NOT repeatedly force re-issuance; that burns more budget.

### Lost or corrupted TLS secret

Applies if `aycemon-tls` is missing, truncated, or holds a cert for
the wrong hostname. cert-manager will normally rebuild it from the
Certificate object on reconcile, but if cert-manager itself is broken
or the ClusterIssuer is not Ready, the Ingress serves the self-signed
fallback indefinitely.

```bash
# 1. Check if cert-manager is healthy:
kubectl -n cert-manager get deploy
kubectl get clusterissuer letsencrypt-staging -o jsonpath='{.status.conditions}'
# If cert-manager is down, recover it first (section 2) before proceeding.

# 2. Inspect the Certificate resource for the failure mode:
kubectl -n aycemon describe certificate aycemon-tls | tail -30
# Look for: "Failed to fetch HTTP-01 challenge", "rate limited",
# "secret type mismatch".

# 3. Force a fresh issuance by deleting the CertificateRequest (NOT the
#    secret — the secret is regenerated from the Certificate):
kubectl -n aycemon delete certificaterequest \
  $(kubectl -n aycemon get certificaterequest \
    -l cert-manager.io/certificate-name=aycemon-tls \
    -o jsonpath='{.items[-1:].metadata.name}')
kubectl -n aycemon get certificate aycemon-tls -w
```

If the issuer is rate-limited (Let's Encrypt prod: 5 duplicate certs
per week, rolling), switch to `letsencrypt-staging` temporarily to
keep the site on a cert-manager-issued chain (browsers will show a
warning; acceptable for a brief incident window), then back to prod
after the window resets. The runbook's section 5 rollback covers the
annotation swap.

### Pod restart loop after secret rotation

Almost always a typo in `.env.local` — the Secret applied but holds
a malformed key.

```bash
kubectl -n aycemon logs -l app=aycemon --tail=50
# Look for: "Error: Invalid API key" (Supabase), "REQUEST_DENIED"
# (Google Places), "WRONGPASS" (Upstash).

# Compare what's on the cluster vs. your local — SHA-256 only, never
# print the raw key material. Even a prefix of a Supabase service-role
# JWT is enough to authenticate, so `head -c 40` on a decoded secret
# is a leak vector (terminal recordings, pasted issue bodies, scrollback).
# Run from the repo root so `.env.local` resolves. A relative path that
# silently reads an empty string would hash to `e3b0c44...` and display
# a confident MISMATCH — worse than a file-not-found error.
REPO_ROOT=$(git rev-parse --show-toplevel)
test -f "$REPO_ROOT/.env.local" || { echo "no .env.local at $REPO_ROOT" >&2; exit 1; }

cluster_digest=$(kubectl -n aycemon get secret aycemon-secrets \
  -o jsonpath='{.data.SUPABASE_SERVICE_ROLE_KEY}' \
  | base64 -d | shasum -a 256 | cut -d' ' -f1)
local_digest=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' "$REPO_ROOT/.env.local" \
  | cut -d= -f2- | tr -d '"'"'" | tr -d '\n' \
  | shasum -a 256 | cut -d' ' -f1)
[ "$cluster_digest" = "$local_digest" ] && echo "match" || echo "MISMATCH"
```

### ingress-nginx rejecting the admission webhook

After any manifest change to `k8s/ingress.yaml`:

```bash
kubectl -n ingress-nginx logs -l app.kubernetes.io/component=controller --tail=50
# look for: "admission webhook ... denied the request"
```

Common causes: missing `ingressClassName`, duplicate `host` in another
Ingress in the same cluster, invalid annotation syntax.

### NetworkPolicy accidentally blocks the app

Symptom: app pods Ready but /api/health returns 500 / 503 and logs
show `ECONNREFUSED` / `ETIMEDOUT` on Supabase calls.

```bash
# Temporarily remove BOTH policies to confirm networkpolicy is the cause.
# Deleting only aycemon-netpol leaves default-deny-all active and the
# pods still have no egress — the symptom will not change, and you will
# mis-diagnose networkpolicy as "not the cause." Both must come down
# together for a valid negative test.
kubectl -n aycemon delete networkpolicy aycemon-netpol default-deny-all

# If the app recovers, the egress rule is what needs fixing. Re-apply the
# full file (recreates both policies together) after adding the missing
# rule:
kubectl -n aycemon apply -f k8s/networkpolicy.yaml
```

The window where both policies are down is an exposure window — every
pod in the namespace has unrestricted ingress/egress. Keep it as short
as physically possible: confirm the hypothesis with a single `curl`
from the pod, then re-apply. Never leave the cluster without a
NetworkPolicy during an incident beyond the triage window. Write a
short post-incident note and update section 8 above with the missing
rule.

---

## Appendix A — GKE Autopilot bootstrap (2026-04-21)

Reproduction procedure for the currently-live cluster. Useful if the
cluster is torn down and recreated. These steps capture the Autopilot-
specific gotchas discovered during the initial provisioning — the generic
plan lives at `plans/k8s-production-hosting.md`.

### Pre-flight (one time, per laptop)

```bash
brew install google-cloud-sdk helm                    # formula, NOT --cask
gcloud auth login                                     # personal account that owns the $300 trial
gcloud config set project aycemon-494018
gcloud components install kubectl gke-gcloud-auth-plugin
echo 'source "$(brew --prefix)/share/google-cloud-sdk/path.zsh.inc"' >> ~/.zshrc
source ~/.zshrc
```

### Provision

```bash
# APIs — all eight are required on a fresh project
gcloud services enable \
  container.googleapis.com compute.googleapis.com \
  cloudresourcemanager.googleapis.com iam.googleapis.com \
  iamcredentials.googleapis.com artifactregistry.googleapis.com \
  logging.googleapis.com monitoring.googleapis.com

# Cluster
gcloud container clusters create-auto aycemon-prod \
  --region us-west1 --release-channel regular

# Reserve the LB IP so it survives Service recreates
gcloud compute addresses create aycemon-ingress \
  --region us-west1 --network-tier=PREMIUM
export LB_IP=$(gcloud compute addresses describe aycemon-ingress \
  --region us-west1 --format='value(address)')
```

### cert-manager — via Helm, NOT the static manifest

```bash
helm repo add jetstack https://charts.jetstack.io && helm repo update
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --version v1.16.1 \
  --set crds.enabled=true \
  --set global.leaderElection.namespace=cert-manager
```

**Why Helm and not the static `kubectl apply -f cert-manager.yaml`:**
the static manifest configures cainjector to acquire its leader-election
lease in `kube-system`. On Autopilot, GKE Warden denies every create in
managed namespaces, so cainjector fails on startup, the webhook caBundle
never injects, and every ClusterIssuer apply errors with
`x509: certificate signed by unknown authority`. The Helm chart's
`global.leaderElection.namespace=cert-manager` flag points the lease at
cert-manager's own namespace and sidesteps the Warden block.

### ingress-nginx — snippet flags required

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --set controller.service.type=LoadBalancer \
  --set controller.service.loadBalancerIP=$LB_IP \
  --set controller.ingressClassResource.default=true \
  --set controller.allowSnippetAnnotations=true \
  --set controller.config.annotations-risk-level=Critical
```

**Why both snippet flags:** `allowSnippetAnnotations=true` turns
snippets on; `annotations-risk-level=Critical` raises the acceptance
ceiling. `k8s/ingress.yaml` uses `nginx.ingress.kubernetes.io/server-snippet`
to hide `/api/metrics` from the public internet (defense-in-depth; the
endpoint is also token-gated at the app layer). Without both values, the
ingress apply is rejected by the admission webhook.

### GitHub Actions build-args

The image bakes `NEXT_PUBLIC_*` at Docker build time. Next.js 13+
inlines these across both client AND server bundles — runtime ConfigMap
values cannot override. If the CI-built image is serving `Error: Your
project's URL and Key are required to create a Supabase client` it
means the GHA Variables were empty when the image was built.

```bash
gh variable set NEXT_PUBLIC_SUPABASE_URL --body "<value>"
gh variable set NEXT_PUBLIC_SUPABASE_ANON_KEY --body "<value>"
# Then re-run the workflow to rebuild the image
gh run rerun <run-id>
```

### CI deploy-job auth (GCP service account, not KUBE_CONFIG)

The deploy job uses `google-github-actions/get-gke-credentials@v2`,
which requires both `container.clusterViewer` (to fetch the cluster
endpoint) AND `container.developer` (to roll the Deployment). Grant
both roles to the SA:

```bash
gcloud iam service-accounts create github-deployer
for role in roles/container.clusterViewer roles/container.developer; do
  gcloud projects add-iam-policy-binding aycemon-494018 \
    --member="serviceAccount:github-deployer@aycemon-494018.iam.gserviceaccount.com" \
    --role="$role" --condition=None
done

# Stream the JSON key straight into GHA without touching disk
gcloud iam service-accounts keys create /dev/stdout \
  --iam-account=github-deployer@aycemon-494018.iam.gserviceaccount.com \
  | gh secret set GCP_SA_KEY
```

Repo Variables for the deploy job:
- `GCP_PROJECT_ID` = `aycemon-494018`
- `GKE_CLUSTER_NAME` = `aycemon-prod`
- `GKE_CLUSTER_REGION` = `us-west1`

### Image name casing

`github.repository` is `DY0810/ayceMon` — Docker requires lowercase.
The build job's `docker/metadata-action` already normalizes. The deploy
step normalizes manually via `tr '[:upper:]' '[:lower:]'`. Keep both.
Don't simplify by plugging `github.repository` into `kubectl set image`
directly — you'll get `InvalidImageName` on the next pod creation.

### The ACME solver NetworkPolicy

`k8s/networkpolicy.yaml` includes a second policy named
`allow-acme-http01-solver`. cert-manager creates a transient solver pod
for each HTTP-01 challenge; the pod's labels (`acme.cert-manager.io/http01-solver=true`)
don't match `app=aycemon`, so `default-deny-all` blocks it. Cert
issuance and renewal stall silently at self-check. The allow-rule is
load-bearing even though the pod only lives for minutes at a time.

### Trial expiry

Activated 2026-04-21, expires 2026-07-20. Default behavior at expiry:
resources **suspend**, card is NOT auto-charged. Tear down ahead of
day 90:

```bash
gcloud container clusters delete aycemon-prod --region us-west1 --quiet
gcloud compute addresses delete aycemon-ingress --region us-west1 --quiet
gh secret delete GCP_SA_KEY
# Remove nip.io from Supabase redirect URLs in the dashboard
```
