# ayceMon — Docker & Kubernetes Deployment

> **Objective:** Containerize the Next.js app with Docker and deploy it on Kubernetes, adding production-grade infrastructure (multi-stage builds, health checks, horizontal scaling, secrets management, and CI/CD).

**Generated:** 2026-04-09 · **Mode:** branch-per-step (git + gh available)
**Base branch:** `main` · **Repo:** `DY0810/ayceMon`

---

## TL;DR

**What you're building:** A multi-stage Docker image for the Next.js 16 standalone output, a docker-compose for local dev, Kubernetes manifests (Deployment, Service, Ingress, HPA, ConfigMap, Secrets), and a GitHub Actions CI/CD pipeline that builds, pushes, and deploys on merge to main.

**Phases (one PR each):**

| # | Phase | Depends on | Parallelizable? | Model tier |
|---|---|---|---|---|
| 1 | Dockerfile + .dockerignore + standalone config | — | no | default |
| 2 | docker-compose for local dev | 1 | no | default |
| 3 | Kubernetes manifests (Deployment, Service, Ingress) | 1 | **‖ with 2** | default |
| 4 | HPA + health probes + resource limits | 3 | no | default |
| 5 | GitHub Actions CI/CD pipeline | 1 | **‖ with 2, 3** | default |
| 6 | Documentation + verification | all | no | default |

**Key decisions:**
- **Next.js standalone output** — `output: "standalone"` in `next.config.ts` produces a self-contained server. The Docker image only copies the standalone folder, dropping `node_modules` entirely. Final image is ~150 MB vs ~1 GB.
- **No Supabase in Docker** — Supabase is a managed cloud service. We don't self-host it. The container connects to the existing Supabase project via env vars.
- **Kubernetes Secrets for env vars** — `SUPABASE_SERVICE_ROLE_KEY` and `GOOGLE_PLACES_API_KEY` go into a K8s Secret, not ConfigMap. Public env vars (`NEXT_PUBLIC_*`) are baked into the image at build time via Docker build args.
- **GHCR (GitHub Container Registry)** — Image pushed to `ghcr.io/dy0810/aycemon` to keep everything in GitHub's ecosystem.

---

## Phase 1 — Dockerfile + .dockerignore + standalone config

**Branch:** `docker/containerize`
**Context:** The Next.js app currently runs via `npm run dev` or `npm run build && npm start`. We need a production Docker image using Next.js standalone output mode.

### Tasks

1. **Enable standalone output** in `next.config.ts`:
   ```ts
   const nextConfig: NextConfig = {
     output: "standalone",
   };
   ```

2. **Create `.dockerignore`** — exclude `node_modules`, `.next`, `.git`, `.env.local`, `e2e/`, `test-results/`, `playwright-report/`, `supabase/`, `plans/`.

3. **Create `Dockerfile`** — multi-stage build:
   - **Stage 1 (`deps`):** `node:20-alpine`, install production dependencies only.
   - **Stage 2 (`builder`):** Copy source, run `npm run build`. Pass `NEXT_PUBLIC_*` env vars as build args so they're baked in.
   - **Stage 3 (`runner`):** `node:20-alpine`, copy standalone output and static assets to correct paths:
     ```dockerfile
     WORKDIR /app
     COPY --from=builder /app/.next/standalone ./
     COPY --from=builder /app/.next/static ./.next/static
     COPY --from=builder /app/public ./public
     ENV HOSTNAME=0.0.0.0
     ENV PORT=3000
     EXPOSE 3000
     USER nextjs
     CMD ["node", "server.js"]
     ```
     **Critical:** `HOSTNAME=0.0.0.0` is required — the standalone server binds to `localhost` by default, which is unreachable from outside the container. Static files must be at `.next/static` relative to `server.js`, and `public` must be at `./public` relative to `server.js`.

4. **Verify:** Build the image locally and run it:
   ```bash
   docker build \
     --build-arg NEXT_PUBLIC_SUPABASE_URL=https://jwnyqoilkkmsqnbzzdnn.supabase.co \
     --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<key> \
     -t aycemon:local .
   docker run -p 3000:3000 \
     -e SUPABASE_SERVICE_ROLE_KEY=<key> \
     -e GOOGLE_PLACES_API_KEY=<key> \
     aycemon:local
   ```
   Hit `http://localhost:3000` — the app should load.

### Exit criteria
- `docker build` succeeds with zero errors.
- `docker run` serves the app on port 3000.
- Image size < 250 MB (check with `docker images aycemon:local`).

### Anti-pattern guards
- **Do NOT copy `node_modules` into the runner stage.** Standalone output bundles its own minimal `node_modules`.
- **Do NOT use `npm run dev` in the Dockerfile.** The container runs `node server.js` (the standalone server).
- **Do NOT hardcode env vars in the Dockerfile.** Use build args for `NEXT_PUBLIC_*` and runtime env vars for secrets.

---

## Phase 2 — docker-compose for local development

**Branch:** `docker/compose-local`
**Depends on:** Phase 1
**Context:** Developers should be able to run `docker compose up` for a quick local test of the production-like container. This is NOT for development (use `npm run dev` for that) — it's for testing the Docker image locally.

### Tasks

1. **Create `docker-compose.yml`**:
   ```yaml
   services:
     app:
       build:
         context: .
         args:
           NEXT_PUBLIC_SUPABASE_URL: ${NEXT_PUBLIC_SUPABASE_URL}
           NEXT_PUBLIC_SUPABASE_ANON_KEY: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}
       ports:
         - "3000:3000"
       environment:
         - SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
         - GOOGLE_PLACES_API_KEY=${GOOGLE_PLACES_API_KEY}
       restart: unless-stopped
   ```

2. **Create `.env.docker.example`** — template showing required vars (no real values).

3. **Verify:** `docker compose up --build` starts the app on port 3000.

### Exit criteria
- `docker compose up --build` works with a valid `.env.local` file.
- `docker compose down` cleanly stops the container.

---

## Phase 3 — Kubernetes manifests

**Branch:** `k8s/manifests`
**Depends on:** Phase 1 (needs the Docker image)
**Context:** Deploy the containerized app on a Kubernetes cluster. Manifests go in a `k8s/` directory.

### Tasks

1. **Create `k8s/namespace.yaml`** — dedicated `aycemon` namespace.

2. **Create `k8s/configmap.yaml`** — non-secret config:
   ```yaml
   apiVersion: v1
   kind: ConfigMap
   metadata:
     name: aycemon-config
     namespace: aycemon
   data:
     NODE_ENV: "production"
     PORT: "3000"
   ```

3. **Create `k8s/secret.yaml`** — template (values base64-encoded, marked as `# REPLACE`):
   ```yaml
   apiVersion: v1
   kind: Secret
   metadata:
     name: aycemon-secrets
     namespace: aycemon
   type: Opaque
   data:
     SUPABASE_SERVICE_ROLE_KEY: # REPLACE with base64-encoded value
     GOOGLE_PLACES_API_KEY: # REPLACE with base64-encoded value
   ```

4. **Create `k8s/deployment.yaml`** — must use `app: aycemon` label on both the Deployment and pod template to match the Service selector:
   ```yaml
   apiVersion: apps/v1
   kind: Deployment
   metadata:
     name: aycemon
     namespace: aycemon
     labels:
       app: aycemon
   spec:
     replicas: 2
     selector:
       matchLabels:
         app: aycemon
     template:
       metadata:
         labels:
           app: aycemon
       spec:
         containers:
           - name: aycemon
             image: ghcr.io/dy0810/aycemon:latest
             ports:
               - containerPort: 3000
             envFrom:
               - configMapRef:
                   name: aycemon-config
               - secretRef:
                   name: aycemon-secrets
             livenessProbe:
               httpGet:
                 path: /
                 port: 3000
               initialDelaySeconds: 10
               periodSeconds: 30
             readinessProbe:
               httpGet:
                 path: /
                 port: 3000
               initialDelaySeconds: 5
               periodSeconds: 10
             resources:
               requests:
                 cpu: 100m
                 memory: 128Mi
               limits:
                 cpu: 500m
                 memory: 512Mi
   ```
   **Critical:** `spec.selector.matchLabels` and `spec.template.metadata.labels` must both have `app: aycemon` — this is what the Service selects on. Mismatched labels = Service routes to zero pods.

5. **Create `k8s/service.yaml`**:
   ```yaml
   apiVersion: v1
   kind: Service
   metadata:
     name: aycemon-service
     namespace: aycemon
   spec:
     selector:
       app: aycemon
     ports:
       - port: 80
         targetPort: 3000
     type: ClusterIP
   ```

6. **Create `k8s/ingress.yaml`**:
   ```yaml
   apiVersion: networking.k8s.io/v1
   kind: Ingress
   metadata:
     name: aycemon-ingress
     namespace: aycemon
     annotations:
       # No rewrite-target needed — Next.js handles its own routing
   spec:
     ingressClassName: nginx
     rules:
       - host: aycemon.local
         http:
           paths:
             - path: /
               pathType: Prefix
               backend:
                 service:
                   name: aycemon-service
                   port:
                     number: 80
   ```

7. **Verify** (if a local K8s cluster is available, e.g. minikube/kind):
   ```bash
   kubectl apply -f k8s/namespace.yaml
   kubectl apply -f k8s/
   kubectl get pods -n aycemon
   kubectl port-forward -n aycemon svc/aycemon-service 3000:80
   ```

### Exit criteria
- `kubectl apply -f k8s/` creates all resources without errors.
- `kubectl get pods -n aycemon` shows 2/2 pods Running.
- Port-forward confirms the app responds on localhost.

### Anti-pattern guards
- **Do NOT put secrets in ConfigMap.** Use the Secret resource.
- **Do NOT use `type: LoadBalancer`** for the Service unless deploying to a cloud provider. `ClusterIP` + Ingress is the standard pattern.
- **Do NOT hardcode the image tag as `latest` in production.** The CI/CD pipeline (Phase 5) will use the Git SHA as the tag. `latest` is only the default for local testing.

---

## Phase 4 — HPA + health probes + resource tuning

**Branch:** `k8s/autoscaling`
**Depends on:** Phase 3
**Context:** Add horizontal pod autoscaling so the app scales with traffic.

### Tasks

1. **Create `k8s/hpa.yaml`**:
   ```yaml
   apiVersion: autoscaling/v2
   kind: HorizontalPodAutoscaler
   metadata:
     name: aycemon-hpa
     namespace: aycemon
   spec:
     scaleTargetRef:
       apiVersion: apps/v1
       kind: Deployment
       name: aycemon
     minReplicas: 2
     maxReplicas: 8
     metrics:
       - type: Resource
         resource:
           name: cpu
           target:
             type: Utilization
             averageUtilization: 70
   ```

2. **Add a dedicated health endpoint** — create `app/api/health/route.ts`:
   ```ts
   export function GET() {
     return Response.json({ status: "ok" });
   }
   ```

3. **Update `k8s/deployment.yaml`** probes to use `/api/health` instead of `/`.

4. **Verify:**
   ```bash
   kubectl apply -f k8s/hpa.yaml
   kubectl get hpa -n aycemon
   ```

### Exit criteria
- HPA is created and shows current/target metrics.
- `/api/health` returns `{"status":"ok"}` with a 200.
- Probes in the deployment point to `/api/health`.

---

## Phase 5 — GitHub Actions CI/CD pipeline

**Branch:** `ci/docker-k8s`
**Depends on:** Phase 1 (only needs the Dockerfile)
**Context:** Automate image builds and pushes on every merge to `main`.

### Tasks

1. **Create `.github/workflows/docker-build.yml`**:
   ```yaml
   name: Build & Push Docker Image
   on:
     push:
       branches: [main]
     pull_request:
       branches: [main]

   env:
     REGISTRY: ghcr.io
     IMAGE_NAME: ${{ github.repository }}

   jobs:
     build:
       runs-on: ubuntu-latest
       permissions:
         contents: read
         packages: write

       steps:
         - uses: actions/checkout@v4

         - name: Log in to GHCR
           uses: docker/login-action@v3
           with:
             registry: ${{ env.REGISTRY }}
             username: ${{ github.actor }}
             password: ${{ secrets.GITHUB_TOKEN }}

         - name: Extract metadata
           id: meta
           uses: docker/metadata-action@v5
           with:
             images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
             tags: |
               type=sha
               type=raw,value=latest,enable={{is_default_branch}}

         - name: Build and push
           uses: docker/build-push-action@v6
           with:
             context: .
             push: ${{ github.event_name != 'pull_request' }}
             tags: ${{ steps.meta.outputs.tags }}
             labels: ${{ steps.meta.outputs.labels }}
             build-args: |
               NEXT_PUBLIC_SUPABASE_URL=${{ vars.NEXT_PUBLIC_SUPABASE_URL }}
               NEXT_PUBLIC_SUPABASE_ANON_KEY=${{ vars.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
   ```

2. **Add GitHub repository variables** (not secrets, these are public):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

3. **Verify:** Push a commit and check that the GitHub Actions workflow runs, builds the image, and pushes to GHCR.

### Exit criteria
- Workflow runs green on push to `main`.
- `ghcr.io/dy0810/aycemon:latest` and `ghcr.io/dy0810/aycemon:sha-<hash>` exist in GHCR.
- PR builds run but do NOT push (dry-run only).

### Anti-pattern guards
- **Do NOT store `NEXT_PUBLIC_*` values as GitHub Secrets.** They're public by definition (shipped to the browser). Use GitHub Variables (`vars.*`), not Secrets (`secrets.*`).
- **Do NOT use `${{ secrets.GITHUB_TOKEN }}` as a build arg.** It must only be used for registry authentication.

---

## Phase 6 — Documentation + verification

**Branch:** `docs/docker-k8s`
**Depends on:** All phases
**Context:** Update README and verify the entire pipeline end-to-end.

### Tasks

1. **Update `README.md`** with new sections:
   - **Docker** — how to build and run locally.
   - **Kubernetes** — how to deploy to a cluster (with `kubectl apply` commands).
   - **CI/CD** — describe the GitHub Actions pipeline.

2. **Add a `k8s/README.md`** with a quick-start for deploying to minikube:
   ```bash
   minikube start
   minikube addons enable ingress
   kubectl apply -f k8s/
   echo "$(minikube ip) aycemon.local" | sudo tee -a /etc/hosts
   curl http://aycemon.local
   ```

3. **End-to-end verification checklist:**
   - [ ] `docker build` succeeds
   - [ ] `docker run` serves the app
   - [ ] `docker compose up` works
   - [ ] `kubectl apply -f k8s/` creates all resources
   - [ ] Pods reach Running state
   - [ ] HPA reports metrics
   - [ ] `/api/health` returns 200
   - [ ] GitHub Actions builds and pushes to GHCR

### Exit criteria
- README includes Docker, K8s, and CI/CD sections.
- All checklist items pass.

---

## Architecture Diagram

```
┌─────────────┐    push to main    ┌──────────────────┐
│   GitHub     │──────────────────▶│  GitHub Actions   │
│   Repo       │                   │  (CI/CD)          │
└─────────────┘                   └────────┬───────────┘
                                           │ docker push
                                           ▼
                                  ┌──────────────────┐
                                  │  GHCR             │
                                  │  ghcr.io/dy0810/  │
                                  │  aycemon:sha-xxx  │
                                  └────────┬───────────┘
                                           │ kubectl pull
                                           ▼
                              ┌─────────────────────────┐
                              │  Kubernetes Cluster      │
                              │                         │
                              │  ┌─────────┐            │
                              │  │ Ingress │            │
                              │  │ (nginx) │            │
                              │  └────┬────┘            │
                              │       ▼                 │
                              │  ┌─────────┐            │
                              │  │ Service │            │
                              │  └────┬────┘            │
                              │       ▼                 │
                              │  ┌────────┐ ┌────────┐  │
                              │  │ Pod 1  │ │ Pod 2  │  │
                              │  │ Next.js│ │ Next.js│  │
                              │  └────────┘ └────────┘  │
                              │       │          │      │
                              │  HPA (2-8 pods)         │
                              └─────────┬───────────────┘
                                        │
                                        ▼
                              ┌──────────────────┐
                              │  Supabase Cloud  │
                              │  (Auth + DB)     │
                              └──────────────────┘
```

---

## Appendix A — File manifest

| File | Phase | Purpose |
|------|-------|---------|
| `next.config.ts` | 1 | Add `output: "standalone"` |
| `Dockerfile` | 1 | Multi-stage production build |
| `.dockerignore` | 1 | Exclude dev files from build context |
| `docker-compose.yml` | 2 | Local container testing |
| `.env.docker.example` | 2 | Env var template |
| `k8s/namespace.yaml` | 3 | Kubernetes namespace |
| `k8s/configmap.yaml` | 3 | Non-secret config |
| `k8s/secret.yaml` | 3 | Secret template |
| `k8s/deployment.yaml` | 3 | App deployment (2 replicas) |
| `k8s/service.yaml` | 3 | ClusterIP service |
| `k8s/ingress.yaml` | 3 | Nginx ingress |
| `k8s/hpa.yaml` | 4 | Horizontal pod autoscaler |
| `app/api/health/route.ts` | 4 | Health check endpoint |
| `.github/workflows/docker-build.yml` | 5 | CI/CD pipeline |
| `README.md` | 6 | Updated docs |
| `k8s/README.md` | 6 | K8s quick-start |
