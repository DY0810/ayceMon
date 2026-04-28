# ayceMon — K8s Production Hosting (GKE)

> **Objective:** Take the shipped K8s infrastructure (all manifests, cert-manager wiring, CI pipeline, metrics endpoint) and actually deploy it to a real managed cluster on Google Kubernetes Engine, using the $300 new-user trial credit. End state: ayceMon serves traffic from both `aycemon.vercel.app` (Vercel, unchanged) and a `*.nip.io` hostname backed by GKE Autopilot with Let's Encrypt TLS and a working CI deploy pipeline.

**Generated:** 2026-04-20 · **Follows:** `plans/multi-user-tracking-k8s-brand.md` (COMPLETE)
**Provider:** Google Kubernetes Engine — Autopilot · **Mode:** dual-host with Vercel · **Billing:** $300 free trial (90 days)

---

## TL;DR

Six phases, mix of ops actions and small repo PRs. No code changes to the app itself — only manifest edits, secret seeding, and CI auth wiring.

**Decisions locked in:**
- **Provider:** GKE **Autopilot** (pay-per-pod-resource, control plane included free; simpler ops than Standard).
- **Region:** `us-west1` (Oregon — close to Supabase `us-west-1` project, low cross-cloud latency).
- **Hostname:** `aycemon.<LB-IP>.nip.io` — computed after the GCP Load Balancer provisions. Let's Encrypt treats `nip.io` as a single eTLD+1 (nip.io is NOT on the Public Suffix List), so all nip.io users share the 50-certs-per-registered-domain-per-week rate limit. Fine for a single hobby deployment; if issuance hits 429 during testing, fall back to `sslip.io` or buy a domain.
- **Cutover:** Dual-host. Vercel stays at `aycemon.vercel.app` (unchanged). K8s adds the nip.io hostname.
- **Monitoring:** ServiceMonitor stays unapplied. `/api/metrics` reachable via `kubectl port-forward`.
- **Billing:** $300 new-user trial — expires 90 days after activation OR when the credit runs out, whichever first. Expected burn: ~$27–32/mo on Autopilot `regular` compute class, so roughly 9–11 months of runway on credits. After day 90, resources **suspend** (not auto-charge) unless you explicitly upgrade the billing account.

**Phase overview:**

| # | Phase | Shape | Est time |
|---|---|---|---|
| 1 | Local tool + GCP account prep | Ops only | 20 min |
| 2 | Create Autopilot cluster + install prereqs (cert-manager + ingress-nginx) | Ops | 30 min |
| 3 | Hostname + issuer config + seed secrets + apply manifests + staging cert | PR #1 + ops | 45 min |
| 4 | Promote staging → production cert | PR #2 + ops | 15 min |
| 5 | Wire CI deploy via service-account JSON (GitHub Actions) | PR #3 + ops | 25 min |
| 6 | Supabase redirect URL + end-to-end signup test + README/runbook | PR #4 | 15 min |

Budget a **~2.5-hour evening.** Most time is waiting on the LB to provision and on ACME to issue.

**Key risks front-loaded:**

- **Which Google account owns the trial.** The $300 credit is per-account and per-first-activation. **Recommend a personal Gmail** rather than `dongyeop@usc.edu` — USC's GWS-for-Education tenant often has GCP trials restricted by the org admin. If the USC account works, fine; but don't burn time troubleshooting org policy violations.
- **90-day hard stop.** Credit expires day 90 even if dollars remain. **Resources suspend automatically unless you explicitly upgrade** — the default behavior is safe (no surprise charges), but the app stops serving from GKE until you act. Set a calendar reminder for **day 85** to decide: upgrade (~$27–32/mo on Autopilot) or tear down.
- **Autopilot auth plugin in CI.** `kubectl` 1.26+ requires `gke-gcloud-auth-plugin` separately. A naive base64 of `~/.kube/config` in CI will fail with `no Auth Provider found for name "gcp"`. Phase 5 uses the `google-github-actions/get-gke-credentials` action to handle this correctly.
- **GHCR image pull still works** from GKE — same public registry, no cloud-specific auth needed. Verified in Phase 1.
- **NetworkPolicy egress is TCP/443 only.** Verified against the codebase: `@upstash/redis` and `@supabase/supabase-js` are REST-over-HTTPS. If anyone later swaps in `pg` or `ioredis`, pods will hang silently until the egress ports are extended. Documented tripwire.
- **Supabase auth-email rate limit (3–4/hour per project free tier)** is shared between Vercel and K8s. Keep the K8s signup test to one account in Phase 6.
- **Let's Encrypt prod rate limit** (5 duplicate certs/week per domain). The runbook stages `letsencrypt-staging` → `letsencrypt-prod` to avoid burning prod budget on a typo. Phase 4 follows that sequence strictly.

---

## Phase 1 — Local tool + GCP account prep

**Shape:** ops-only. Nothing committed.

### Tasks

1. **Pick the Google account** — recommend **personal Gmail** for the trial. If you decide to use a `.edu` org account, try it first; if the billing console shows "Trial not available for your organization," switch to Gmail without burning time on org-policy debugging.

2. **Activate the $300 free trial:**
   - Go to https://console.cloud.google.com
   - Sign in, accept terms, add a payment method (required; won't be charged during trial).
   - Note your billing account ID (format `01XXXX-XXXXXX-XXXXXX`).
   - **Set a calendar reminder for 85 days from today** titled "GKE trial expires — upgrade or tear down."

3. **Create a new project:**
   - Console → "Select a project" → "New Project" → name `aycemon-prod` → note the **Project ID** (GCP auto-suggests one like `aycemon-prod-12345`).
   - Link billing to the new project.

4. **Enable required APIs.** Cluster create will fail if any of these are disabled at the project level:
   ```bash
   gcloud services enable \
     container.googleapis.com \
     compute.googleapis.com \
     cloudresourcemanager.googleapis.com \
     iam.googleapis.com \
     iamcredentials.googleapis.com \
     artifactregistry.googleapis.com \
     logging.googleapis.com \
     monitoring.googleapis.com
   ```
   Autopilot enables Cloud Logging/Monitoring by default and the provisioner probes Artifact Registry during node-image fetches — all three must be on.

5. **Install `gcloud` CLI + plugins.**

   **IMPORTANT:** Homebrew has both a cask (`--cask google-cloud-sdk`) and a formula (`google-cloud-sdk`). The **cask disables the component manager**, so `gcloud components install` fails with "component manager is disabled." Use the formula path, OR install the cask and then brew-install `kubectl` separately and manually download `gke-gcloud-auth-plugin`.

   Recommended (formula path):
   ```bash
   brew install google-cloud-sdk        # formula — NOT --cask
   gcloud auth login                    # opens browser
   gcloud config set project aycemon-prod-12345   # your actual project ID
   gcloud components install kubectl gke-gcloud-auth-plugin
   ```

   If you already have the cask installed:
   ```bash
   brew install kubectl
   gcloud components list 2>&1 | head -5
   # If you see "component manager is disabled": uninstall the cask and
   # reinstall via the formula, OR download the plugin manually:
   #   gcloud auth application-default login
   #   (the auth plugin ships with recent gcloud versions; check with
   #    `gke-gcloud-auth-plugin --version`.)
   ```

6. **Install helm** (needed for ingress-nginx in Phase 2):
   ```bash
   brew install helm
   ```

7. **Verify the GHCR image pulls:**
   ```bash
   docker pull ghcr.io/dy0810/aycemon:latest
   ```
   If `unauthorized`, make the package public at https://github.com/users/DY0810/packages/container/aycemon/settings.

### Exit criteria

- `gcloud config list` shows the right account + project.
- `gcloud services list --enabled` includes `container.googleapis.com` and `compute.googleapis.com`.
- `kubectl version --client` and `helm version` print versions.
- `gke-gcloud-auth-plugin --version` prints a version (needed for cluster auth).
- `docker pull ghcr.io/dy0810/aycemon:latest` succeeds.
- Calendar reminder set for day 85.

---

## Phase 2 — Create Autopilot cluster + install prereqs

**Shape:** ops, one sitting.

### Tasks

1. **Create the cluster** — one command with Autopilot:

   ```bash
   gcloud container clusters create-auto aycemon-prod \
     --region us-west1 \
     --release-channel regular
   ```

   Takes 6–10 minutes. Autopilot manages node pools automatically; you don't specify size/count. Auth to the cluster gets wired into `~/.kube/config` automatically.

2. **Verify kubectl works:**
   ```bash
   kubectl get nodes
   # Autopilot shows the managed node(s); usually 2–3 small ones to start.
   ```

3. **Reserve a regional static IP for the ingress Load Balancer** — this is how you pin the IP so it doesn't change if the Service is recreated. (GCP equivalent of the DO loadbalancer-name annotation.)

   **Network tier must match the Service that will bind to it.** GCP's project default network tier is Premium; a regional static IP reserved without `--network-tier` defaults to Premium. If you ever want Standard-tier to save on egress, reserve and bind consistently — mismatched tier = controller Service stays `<pending>` with `IP_ADDRESS_TYPE_MISMATCH`.

   ```bash
   gcloud compute addresses create aycemon-ingress \
     --region us-west1 \
     --network-tier=PREMIUM
   LB_IP=$(gcloud compute addresses describe aycemon-ingress \
     --region us-west1 --format='value(address)')
   echo "$LB_IP"   # capture — referenced in Phase 2 step 5 and Phase 3 step 1
   ```

   Cost: free while attached to the in-use LB; ~$1.50/mo if detached. Keeps the IP stable across Helm reinstalls.

4. **Install cert-manager:**
   ```bash
   kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.16.1/cert-manager.yaml
   kubectl -n cert-manager wait --for=condition=Available deployment --all --timeout=180s
   # The webhook service can still 500 for a few seconds after Deployment=Available:
   kubectl -n cert-manager wait --for=condition=Ready pod \
     -l app.kubernetes.io/component=webhook --timeout=120s
   ```

5. **Install ingress-nginx via Helm.** Bind the Service to the reserved static IP so the LB uses the same address across reinstalls:

   ```bash
   helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
   helm repo update
   helm install ingress-nginx ingress-nginx/ingress-nginx \
     --namespace ingress-nginx --create-namespace \
     --set controller.service.type=LoadBalancer \
     --set controller.service.loadBalancerIP=$LB_IP \
     --set controller.ingressClassResource.default=true
   ```

   GCP auto-provisions a Network Load Balancer pointing at the reserved IP. Wait for it to attach:

   ```bash
   kubectl -n ingress-nginx get svc ingress-nginx-controller -w
   # Ctrl-C once EXTERNAL-IP matches $LB_IP (not <pending>).
   ```

6. **Wait for the ingress-nginx admission webhook.** Fresh clusters will 500 on the first Ingress apply (`failed calling webhook "validate.nginx.ingress.kubernetes.io"`) for ~30–60s after `helm install` returns. Prevent the race:

   ```bash
   kubectl -n ingress-nginx wait --for=condition=Available \
     deployment/ingress-nginx-controller --timeout=180s
   kubectl -n ingress-nginx rollout status \
     deploy/ingress-nginx-controller --timeout=180s
   ```

7. **NetworkPolicy note:** GKE Autopilot enforces `NetworkPolicy` by default (Calico-based via Dataplane V2 / Cilium on newer releases). `k8s/networkpolicy.yaml` will work as-is. `k8s/cilium-networkpolicy.yaml` (Cilium CRDs for FQDN egress) only applies if the cluster runs Cilium Dataplane V2 — skip for Phase 3 unless `kubectl get crd ciliumnetworkpolicies.cilium.io` returns a match.

### Exit criteria

- `gcloud container clusters list` shows `aycemon-prod` RUNNING.
- `kubectl get nodes` shows managed nodes Ready.
- `kubectl -n cert-manager get pods` all Running AND Ready.
- `kubectl -n ingress-nginx get svc ingress-nginx-controller` shows `EXTERNAL-IP` matching `$LB_IP`.
- `kubectl -n ingress-nginx rollout status deploy/ingress-nginx-controller` returns success.

### Anti-pattern guards

- **Do not** use GKE Standard unless you have a reason — Autopilot is cheaper for this workload (pay-per-pod-resource rather than per-node-hour) and easier to operate.
- **Do not** use the built-in GCE Ingress (`ingressClassName: gce`) instead of ingress-nginx. Our manifests + cert-manager setup assume nginx. Swapping breaks the annotation chain.
- **Do not** release the reserved static IP during troubleshooting. An unreserved LB gets a new IP on recreate, invalidating the nip.io hostname.

---

## Phase 3 — Hostname + issuer + secrets + apply manifests

**Shape:** PR #1 (ingress hostname + issuer email) + ops (secret seeding + kubectl apply).

### Tasks — Repo edits (PR #1)

1. **Compute the hostname** — using the reserved `LB_IP`:
   ```
   AYCEMON_HOST=aycemon.${LB_IP//./-}.nip.io
   # e.g. aycemon.35-230-12-45.nip.io
   ```

2. **Edit `k8s/ingress.yaml`** — replace both `aycemon.local` occurrences with the computed `AYCEMON_HOST`. Keep `ingressClassName: nginx` and the `cert-manager.io/cluster-issuer: letsencrypt-staging` annotation.

3. **Edit `k8s/cert-manager/cluster-issuer.yaml`** — replace `REPLACE-ME-WITH-TEAM-ALIAS@aycemon.app` with a real address you monitor. Let's Encrypt sends expiry warnings here; an unmonitored inbox = silent outage.

4. **Branch and PR:**
   ```
   git switch -c k8s/prod-hostname-and-issuer
   git commit -am "k8s: point ingress at nip.io host + real issuer contact"
   gh pr create --title "k8s: point ingress at nip.io host + set issuer email" --body "Sets ingress host to aycemon.$LB_IP.nip.io and wires a real contact email on letsencrypt-staging ClusterIssuer. Preparation for initial cluster apply. No runtime impact until manifests are applied with the new values."
   ```
   Merge after CI's `build` job passes. `deploy` will keep failing until Phase 5.

### Tasks — Ops (after PR #1 merges)

5. **Seed the Secret.** `scripts/k8s-seed-secrets.sh` defaults `KUBE_CONTEXT=kind-aycemon`. You MUST override it for GKE or the script errors or silently targets kind:

   ```bash
   git switch main && git pull
   # Confirm .env.local exists with the three required keys. Copy from
   # .env.docker.example if missing and fill in:
   #   SUPABASE_SERVICE_ROLE_KEY=...
   #   GOOGLE_PLACES_API_KEY=...
   #   METRICS_SCRAPE_TOKEN=<`openssl rand -hex 32`>

   GKE_CTX=$(kubectl config current-context)   # gke_<project>_<region>_<cluster>
   KUBE_CONTEXT=$GKE_CTX ./scripts/k8s-seed-secrets.sh
   # Creates the aycemon namespace if missing. The kind-only placeholder
   # ghcr-pull-secret is skipped automatically (context isn't kind-*).
   ```

6. **Apply ClusterIssuer** (staging only; prod stays commented out in the file):
   ```bash
   kubectl apply -f k8s/cert-manager/cluster-issuer.yaml
   kubectl get clusterissuer letsencrypt-staging \
     -o jsonpath='{.status.conditions[0]}{"\n"}'
   # Expect: Ready=True
   ```

7. **Apply app manifests:**
   ```bash
   kubectl apply -f k8s/configmap.yaml
   kubectl apply -f k8s/deployment.yaml
   kubectl apply -f k8s/service.yaml
   kubectl apply -f k8s/pdb.yaml
   kubectl apply -f k8s/hpa.yaml
   kubectl apply -f k8s/networkpolicy.yaml
   kubectl apply -f k8s/ingress.yaml
   # Skip cilium-networkpolicy.yaml and servicemonitor.yaml per Phase 2 step 7.
   # If the Ingress apply fails with a webhook validation error, retry after
   # 30s — the admission webhook race is narrow but not impossible.
   ```

8. **Wait for rollout + cert:**
   ```bash
   kubectl -n aycemon rollout status deployment/aycemon --timeout=180s
   kubectl -n aycemon get certificate aycemon-tls -w
   # Ctrl-C once READY=True (typically 30–90s after Ingress exists).
   ```

### Verification

- `kubectl -n aycemon get pods` shows 2/2 Ready.
- `curl -sk https://$AYCEMON_HOST/api/health` returns `{"status":"ok"}`. The `-k` is because the cert is from Let's Encrypt **staging** (untrusted root) at this point.
- `kubectl -n aycemon describe certificate aycemon-tls` shows `Status: Ready`.

### Exit criteria

- PR #1 merged.
- App pods Running on GKE.
- Staging cert issued.
- Ingress responds at the nip.io hostname.

### Anti-pattern guards

- **Do not** paste `SUPABASE_SERVICE_ROLE_KEY` into a terminal you're recording. Even a 40-char JWT prefix is enough to authenticate as service role.
- **Do not** apply `k8s/cilium-networkpolicy.yaml` unless `ciliumnetworkpolicies.cilium.io` CRD exists — mismatched CRD versions can silently no-op the policy.

---

## Phase 4 — Promote staging → production cert

**Shape:** PR #2 (uncomment prod ClusterIssuer) + one ops step.

### Tasks

1. **Verify the 4-point activation checklist** from `k8s/cert-manager/cluster-issuer.yaml`:
   - [x] A real hostname resolves to the LB IP (nip.io handles this).
   - [ ] `curl http://$AYCEMON_HOST/.well-known/acme-challenge/probe` reaches the cluster from public internet (test from a phone on cell data or from outside your network). A 404 from ingress-nginx = reachable.
   - [x] Staging issued a cert for the same hostname (Phase 3).
   - [x] Ingress uses the real hostname (Phase 3).

2. **PR #2 — uncomment prod ClusterIssuer:**
   - Edit `k8s/cert-manager/cluster-issuer.yaml` — uncomment the `letsencrypt-prod` block. Verify the email matches staging.
   - Edit `k8s/ingress.yaml` — change the annotation from `letsencrypt-staging` to `letsencrypt-prod`.
   - Commit, open PR, merge.

3. **Apply + force fresh issuance:**
   ```bash
   git switch main && git pull
   kubectl apply -f k8s/cert-manager/cluster-issuer.yaml
   kubectl apply -f k8s/ingress.yaml
   kubectl -n aycemon delete secret aycemon-tls   # force re-issuance from prod
   kubectl -n aycemon get certificate aycemon-tls -w
   ```

### Verification

- `curl -I https://$AYCEMON_HOST/` returns 200 WITHOUT `-k`. Browser trusts the cert.
- `openssl s_client -connect $AYCEMON_HOST:443 -servername $AYCEMON_HOST </dev/null 2>/dev/null | openssl x509 -noout -issuer` shows `O = Let's Encrypt`, not `CN = (STAGING)`.

### Exit criteria

- Public HTTPS works with a browser-trusted cert.

### Anti-pattern guards

- **Do not** flip staging/prod issuer annotations iteratively to "force a refresh" — each flip consumes a slot in the 5-duplicates-per-week prod rate limit.

---

## Phase 5 — Wire CI deploy (service-account + GitHub Actions)

**Shape:** PR #3 (workflow edit) + GCP IAM setup + GitHub secret.

### Why this phase is heavier than the DO equivalent

The current `.github/workflows/docker-build.yml` deploy job base64-decodes a `KUBE_CONFIG` secret. That works for static kubeconfigs (like kind or DO). GKE kubeconfigs embed references to `gke-gcloud-auth-plugin`, which GitHub Actions runners don't have by default. Cleaner path: use `google-github-actions/get-gke-credentials`, which sets up auth correctly.

### Tasks

1. **Create a service account for CI:**
   ```bash
   gcloud iam service-accounts create github-deployer \
     --description="CI deploy bot for ayceMon" \
     --display-name="GitHub Deployer"

   # roles/container.developer grants namespaced edit inside the cluster,
   # BUT `get-gke-credentials` also needs `container.clusters.get` to fetch
   # the cluster endpoint — that's in roles/container.clusterViewer.
   # Missing the clusterViewer grant is the single most common GKE-CI
   # failure mode; add both.
   for role in roles/container.clusterViewer roles/container.developer; do
     gcloud projects add-iam-policy-binding aycemon-prod-12345 \
       --member="serviceAccount:github-deployer@aycemon-prod-12345.iam.gserviceaccount.com" \
       --role="$role"
   done
   # NOT roles/owner or roles/container.admin — principle of least privilege.
   ```

2. **Download a JSON key for the service account.** Two options:

   **Option A — never-touches-disk (recommended on macOS):**
   ```bash
   gcloud iam service-accounts keys create /dev/stdout \
     --iam-account=github-deployer@aycemon-prod-12345.iam.gserviceaccount.com \
     | pbcopy
   # Key is now on the clipboard. Paste into GitHub in step 3 and it never
   # lands in shell history, ~/, Time Machine, or the clipboard-manager log.
   ```

   **Option B — file-on-disk:**
   ```bash
   gcloud iam service-accounts keys create ~/gha-sa-key.json \
     --iam-account=github-deployer@aycemon-prod-12345.iam.gserviceaccount.com
   cat ~/gha-sa-key.json | pbcopy
   # MUST delete after step 3 — see step 5.
   ```

3. **Add the secret to GitHub:**
   - https://github.com/DY0810/ayceMon/settings/secrets/actions
   - "New repository secret"
   - Name: `GCP_SA_KEY`
   - Value: paste
   - Also add `GCP_PROJECT_ID` = `aycemon-prod-12345` and `GKE_CLUSTER_NAME` = `aycemon-prod` and `GKE_CLUSTER_REGION` = `us-west1` as **repository variables** (not secrets — non-sensitive).

4. **PR #3 — rewrite the deploy job** in `.github/workflows/docker-build.yml`:

   ```yaml
     deploy:
       if: github.event_name == 'push' && github.ref == 'refs/heads/main'
       needs: build
       runs-on: ubuntu-latest
       permissions:
         contents: read
       steps:
         - uses: google-github-actions/auth@v2
           with:
             credentials_json: ${{ secrets.GCP_SA_KEY }}

         - uses: google-github-actions/get-gke-credentials@v2
           with:
             project_id: ${{ vars.GCP_PROJECT_ID }}
             cluster_name: ${{ vars.GKE_CLUSTER_NAME }}
             location: ${{ vars.GKE_CLUSTER_REGION }}

         - name: Deploy to GKE
           run: |
             IMAGE="${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:sha-$(echo $GITHUB_SHA | cut -c1-7)"
             kubectl set image deployment/aycemon aycemon=$IMAGE -n aycemon
             kubectl rollout status deployment/aycemon -n aycemon --timeout=120s
   ```

   Drop the old `KUBE_CONFIG` references from the workflow. Remove any unused `KUBE_CONFIG` secret afterward.

5. **Delete the local SA key file** (Option B only — skip if you used Option A):
   ```bash
   rm ~/gha-sa-key.json
   ```
   DO NOT leave the private key on disk longer than needed.

6. **Trigger the deploy job:**
   ```bash
   gh workflow run docker-build.yml --ref main
   gh run watch
   ```
   The `deploy` job should now succeed: `get-gke-credentials` writes a kubeconfig that includes the auth-plugin reference and installs the plugin in the runner, `kubectl set image` rolls the Deployment.

7. **Verify rolling update end-to-end:**
   - Edit a trivial string in `app/page.tsx`, commit on a branch, merge to main.
   - Watch CI: `build` pushes image, `deploy` rolls out.
   - `curl https://$AYCEMON_HOST/` reflects the change within ~2 min, no 5xx during the switch.

### Verification

- `gh run list --limit 3` shows main-push workflows with both jobs `success`.
- `kubectl -n aycemon rollout history deployment/aycemon` shows multiple revisions.

### Exit criteria

- CI `deploy` job green on main pushes.
- Rolling update demonstrably works.
- Local SA key deleted.

### Anti-pattern guards

- **Do not** grant `roles/owner` to the CI service account. `roles/container.developer` is enough.
- **Do not** commit the JSON key to the repo. Even in a deleted commit it's still in git history.
- **Do not** skip step 5 — a leaked SA key is a full-project compromise until rotated.
- **Consider upgrading to Workload Identity Federation** later — eliminates the long-lived JSON key entirely. Overkill for this phase.

---

## Phase 6 — Supabase redirect URL + signup test + docs

**Shape:** PR #4 (README + runbook) + Dashboard ops.

### Tasks

1. **Add the nip.io origin to Supabase redirect URLs:**
   - Dashboard: https://supabase.com/dashboard/project/jwnyqoilkkmsqnbzzdnn/auth/url-configuration
   - Leave **Site URL** as `https://aycemon.vercel.app`.
   - Add `https://$AYCEMON_HOST/**` to **Redirect URLs**.
   - Save.

2. **End-to-end signup test through the K8s endpoint:**
   - Incognito → `https://$AYCEMON_HOST`.
   - Sign up with a fresh email alias (`yourname+k8s1@gmail.com`).
   - Confirm branded email arrives.
   - Click CTA — must land back on `$AYCEMON_HOST` (not `aycemon.vercel.app`).
   - Run one shared-session flow (start, log, finish) to confirm per-person panel + activity feed.
   - **Stop at one signup attempt.** Supabase's auth-email rate limit is shared with Vercel users.

3. **PR #4 — documentation:**
   - Update `README.md` "Running on Kubernetes" section — note the nip.io live URL and dual-host setup.
   - Append a "Production provisioning (GKE Autopilot)" section to `docs/k8s-runbook.md` consolidating Phases 1–5 into a rerun-able procedure.
   - Add `docs/screenshots/k8s-prod-cert.png` proving browser lock + Let's Encrypt issuer on the live URL.

4. **Update memory** — append to `~/.ide/memory/MEMORY.md`:
   ```
   - [K8s production hosting (GKE, COMPLETE)](project_k8s_hosting_plan.md) — GKE Autopilot cluster aycemon-prod in us-west1; live at aycemon.<IP>.nip.io; dual-hosted alongside Vercel; CI deploys via github-deployer SA; trial expires <date>
   ```
   Create the referenced memory file with cluster details, LB IP, SA email, billing account, trial expiry date.

### Verification

- Signup through nip.io URL delivers branded email AND redirects back to nip.io on confirm.
- Shared-session flow works end-to-end.
- README reflects live status.

### Exit criteria

- Both `aycemon.vercel.app` and the nip.io hostname serve ayceMon.
- Runbook captures the provisioning procedure.
- Memory indexes completion + trial expiry reminder.

---

## Appendix A — Cost summary (post-trial, steady state)

All figures assume **Premium-tier network** (GCP default) and the **`regular` Autopilot compute class** in `us-west1`. Rates as of 2026 rate card.

| Line item | Monthly |
|---|---|
| GKE Autopilot control plane | $0 (free for Autopilot) |
| Pod resources: 2 × (100m vCPU × $0.0445/hr + 128Mi × $0.0049225/GB-hr) × 730 hr | ~$8 |
| Regional external-passthrough Network Load Balancer (first 5 forwarding rules) | ~$18 |
| Static IP reservation (attached) | $0 (free while in use) |
| Egress bandwidth | First 1GB/mo free, $0.12/GB after. Negligible at this scale. |
| Cloud Logging + Monitoring (on-by-default for Autopilot) | $0 for the free-tier volume this workload generates (<50 GiB logs/mo) |
| **Total baseline** | **~$27–32/mo** |

During the $300 trial: **$0 out of pocket**. Expect ~9–11 months of runway before the credit dollars run out (though the trial itself hard-expires at day 90 regardless of remaining dollars).

**Switching to Standard-tier network** saves ~30% on egress but routes traffic through cheaper peering — acceptable for this workload. If you care: reserve the address with `--network-tier=STANDARD` and annotate the Service with `cloud.google.com/network-tier: Standard`. Both must match.

**Teardown command** (run before trial expiry if you don't want to pay):
```bash
gcloud container clusters delete aycemon-prod --region us-west1
gcloud compute addresses delete aycemon-ingress --region us-west1
# Then delete the project entirely to stop all background billing:
gcloud projects delete aycemon-prod-12345
```

## Appendix B — Rollback

K8s deployment misbehaving = Vercel unaffected for page serving. aycemon.vercel.app stays canonical.

Shared failure surface: **Supabase's auth-email rate limit is per-project**. If K8s bursts failed signups, Vercel confirmation emails can be blocked for ~1hr. Keep the Phase 6 test to a single account.

Teardown: see Appendix A commands. Follow up with:
1. Remove nip.io from Supabase redirect URLs.
2. Delete `GCP_SA_KEY` from GitHub secrets.
3. Optionally revert PR #1–#3 ingress/issuer/workflow edits.
4. Rotate the SA key in GCP IAM (defense-in-depth even if you think it never leaked).

## Appendix C — What we deliberately aren't doing

- **Custom domain.** nip.io is the proving-ground. Buy `aycemon.app` later, point A-record at the reserved LB IP, second Ingress rule, re-issue cert.
- **Workload Identity Federation** for CI auth. JSON-key SA is simpler for solo; migrate to WIF later if you expand the team.
- **Artifact Registry.** GHCR works; no reason to double-host the image.
- **Prometheus / Grafana.** `servicemonitor.yaml` stays unapplied.
- **Multi-region / multi-zone.** One region. Vercel handles edge.
- **FQDN egress** via `k8s/cilium-networkpolicy.yaml`. TCP/443 is sufficient for current REST-only clients. Tripwire: if someone adds `pg` or `ioredis`, pods will hang until egress is extended.
- **GKE Standard.** Autopilot is the right choice here — cheaper for small workloads, fewer ops knobs.
- **Cluster autoscaler config.** Autopilot manages node lifecycle automatically. No `--min-nodes` / `--max-nodes` to tune.
- **Replacing Vercel.** Dual-hosted steady state is fine; no DNS flip planned.

## Appendix D — Trial-expiry decision tree

**Day 85:** calendar reminder fires.

**Default behavior if you do nothing:** at day 90, GCP suspends cluster resources and stops billing. The card on file is **not auto-charged**. This is safe — but the app stops serving from GKE (Vercel keeps serving `aycemon.vercel.app` unaffected). Suspended resources are recoverable for ~30 days if you upgrade within that window.

Options:

1. **Upgrade to paid (~$27–32/mo)?** → Billing console → "Upgrade". Explicit opt-in; no auto-flip. No infra changes. Continue.
2. **Tear down, keep Vercel-only?** → Run the teardown in Appendix A. Remove nip.io from Supabase, delete CI secrets. ~15 min. Clean state.
3. **Apply for Google for Startups / Education credits?** → Must apply **before** expiry. Programs can extend credits 3–12 months depending on qualifying. USC students often qualify for Google for Education research credits via a faculty sponsor.
4. **Ignore?** → Resources suspend at day 90. App unreachable on nip.io. Vercel still serves. Decision can be deferred to the 30-day recovery window without data loss (the PVs this project doesn't use).

Pick ahead of day 90 so the transition is intentional rather than an accidental outage on nip.io.
