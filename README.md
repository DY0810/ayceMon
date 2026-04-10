# ayceMon

Track whether you're beating the buffet. Start a session, build a library of items with their à la carte prices, eat strategically, and see if you got your money's worth.

## Prerequisites

- Node.js 20+
- npm 10+
- A [Supabase](https://supabase.com) project (free tier works)
- A [Google Places API (New)](https://developers.google.com/maps/documentation/places/web-service/overview) key (optional — the app works without it, but restaurant autocomplete will be disabled)

## Environment Variables

Copy `.env.local.example` (or create `.env.local`) with these keys:

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
GOOGLE_PLACES_API_KEY=<your-places-api-key>
```

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are safe for the client bundle.
- `SUPABASE_SERVICE_ROLE_KEY` and `GOOGLE_PLACES_API_KEY` are **server-only** — they are never shipped to the browser. Modules that use them import `"server-only"` to enforce this at build time.

## Supabase Setup

1. Install the Supabase CLI as a dev dependency (already in `package.json`):
   ```bash
   npm install
   ```
2. Link your local project to a remote Supabase project:
   ```bash
   npx supabase link --project-ref <your-project-ref>
   ```
3. Apply migrations:
   ```bash
   npx supabase db push
   ```
4. Generate TypeScript types (optional — already committed):
   ```bash
   npx supabase gen types typescript --linked > lib/supabase/database.types.ts
   ```

## Google Places API Key

1. Create a Google Cloud project and enable the **Places API (New)**.
2. Create an API key restricted to the Places API (New) and server IPs only.
3. **Set a billing quota cap** (recommended: $25/day for dev) before adding the key to `.env.local`.
4. Paste the key as `GOOGLE_PLACES_API_KEY` in `.env.local`.

Without a valid key, the restaurant combobox falls back to a free-text input. Sessions started without a resolved place cannot be saved to the database for signed-in users.

## Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Linting & Tests

```bash
npm run lint          # ESLint (no-explicit-any: error)
npm test              # Vitest unit tests
```

## E2E Tests (Playwright)

Two E2E specs live in `e2e/`:

- **`guest-path.spec.ts`** — The original guest flow: setup → library → combos → tracker → result. No auth required.
- **`signed-in-path.spec.ts`** — Sign in → setup → library → tracker → finish → history → stats. Requires a running Supabase project with valid env vars; seeds a test user via the admin API and cleans up after.

To run:

```bash
npx playwright install chromium   # first time only
npx playwright test               # runs both specs
npx playwright test e2e/guest-path.spec.ts       # guest only
npx playwright test e2e/signed-in-path.spec.ts   # signed-in only
```

The Playwright config starts a dev server automatically (`npm run dev`). Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in your environment for the signed-in spec.

## Build

```bash
npm run build
npm start
```

## Docker

The app uses a multi-stage Docker build with Next.js standalone output. Public env vars are baked in at build time; secrets are injected at runtime.

**Build the image:**

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key> \
  -t aycemon .
```

**Run it:**

```bash
docker run -p 3000:3000 \
  -e SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
  -e GOOGLE_PLACES_API_KEY=<places-api-key> \
  aycemon
```

**Or use Docker Compose** (reads from `.env.local`):

```bash
docker compose up --build
```

## Kubernetes

Manifests live in `k8s/`. Before applying, edit `k8s/secret.yaml` and replace the placeholder values with real base64-encoded secrets:

```bash
echo -n "your-secret" | base64
```

**Deploy to a cluster:**

```bash
kubectl apply -f k8s/
kubectl get pods -n aycemon       # verify pods are Running
```

**Access locally via port-forward:**

```bash
kubectl port-forward -n aycemon svc/aycemon-service 3000:80
```

Then open [http://localhost:3000](http://localhost:3000).

See [`k8s/README.md`](k8s/README.md) for a minikube quick-start.

## CI/CD

A GitHub Actions workflow (`.github/workflows/docker-build.yml`) builds and pushes the Docker image to GHCR:

- **On merge to `main`:** builds, tags with the Git SHA + `latest`, and pushes to `ghcr.io/dy0810/aycemon`.
- **On pull requests:** builds only (dry-run, no push).

**Required GitHub Variables** (not Secrets — these are public):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
