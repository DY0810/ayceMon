# ayceMon — Multi-user Tracking, K8s Hardening & Brand Refresh

> **Objective:** Close the collaborative-tracking gaps (per-person cost, activity feed, join notifications, branded email), harden the existing Kubernetes deployment so it runs end-to-end locally and in production, and refresh the brand with a new logo and accent palette without breaking the monochrome-data discipline.

**Generated:** 2026-04-18 · **Mode:** branch-per-step (git + gh available)
**Base branch:** `main` · **Repo:** `DY0810/ayceMon`

---

## TL;DR

Three problem clusters, 10 steps, one PR each.

**Cluster A — Multi-user tracking (issues 2, 3, 4):** The shared-session backend is shipped (migrations `0005`–`0007`, polling hook, RLS). What's missing is the UI: the tracker aggregates every collaborator's entries into a single total, shows a roster of names, and nothing else. Users cannot tell who ate what, who just joined, or how the bill would split. We add a contributors endpoint (server aggregation), a per-person breakdown panel, a reverse-chronological activity feed, and a join-notification toast.

**Cluster B — Branded verification email (issue 1):** Supabase is sending the stock confirmation template. We commit branded HTML templates at `supabase/email-templates/` (confirmation, magic-link, password-reset, invite, change-email), wire them through `supabase/config.toml` under `[auth.email.template.*]`, and document the one-time dashboard mirror step for the hosted project.

**Cluster C — Kubernetes + brand refresh (features):** The Dockerfile, manifests, and CI already exist from the April 13 rollout (`plans/docker-kubernetes.md`). This plan adds what's missing for "must run using Kubernetes" as a first-class workflow: a kind/minikube bootstrap script, a Skaffold dev loop, cert-manager-issued TLS, and a production runbook. The brand refresh introduces one accent color (a warm persimmon) plus a new SVG logo mark, rolled out through DESIGN.md tokens so every existing component inherits the change.

**Phases:**

| # | Phase | Depends on | Parallelizable? | Model tier |
|---|---|---|---|---|
| 1 | Design system v2 — accent palette + logo mark + DESIGN.md revision | — | — | **strongest** |
| 1a | **USER APPROVAL GATE** — design revision signed off before Phase 2 | 1 | — | — |
| 2 | Brand rollout — nav logo, CTA accent, focus ring token consumers | 1a | — | default |
| 3 | Branded Supabase email templates + SMTP wiring | — | ‖ with 1, 2, 4 | default |
| 4 | `listContributors` server action + `/api/shared-session/[id]/contributors` | — | ‖ with 1, 2, 3 | default |
| 5 | Per-person cost breakdown panel on `/tracker` | 2, 4 | — (serialized with 6, 7) | default |
| 6 | Per-person activity feed on `/tracker` | 4, 5 | — (serialized) | default |
| 7 | Collaborator-joined toast (roster-diff detector) | 5, 6 | — (serialized) | default |
| 8 | K8s local dev kit — kind bootstrap + Skaffold loop | — | ‖ with 1–7 | default |
| 9 | K8s production hardening — cert-manager TLS, PDB, NetworkPolicy audit, runbook | 8 | — | default |
| 9b | K8s metrics endpoint + ServiceMonitor (reviewability split from 9) | 9 | — | default |
| 10 | End-to-end verification + README + status banners | all | — | default |

**Key decisions (front-loaded so downstream steps don't re-litigate):**

- **Accent color is additive, not replacement.** Step 1 revises DESIGN.md §2 to "**one** accent, **one** role" — the persimmon (`#F55A2B` light / `#FF7A4A` dark) appears on the logo mark, the wordmark "Mon" suffix, the primary CTA hover state, and the `ayce-win-pulse` — nowhere else. Data surfaces (card totals, tables, progress bars, prices) stay monochrome. This preserves the financial-dashboard feel while giving the product a visual anchor.
- **No realtime subscriptions.** The existing 2.5s poll in `lib/use-shared-session.ts` is the single source of truth. Steps 5–7 attach to that poll rather than opening a Supabase realtime channel, because realtime adds a second auth surface (RLS on broadcast channels) we don't need for a 2-10 person session.
- **Per-person `valueEaten` is recomputed client-side** from the polled rows, not stored. The `contributors` jsonb on `session_records` is written only at finalize time (already shipped). Live display derives from `shared_session_entries × shared_session_items` — same math the aggregate already uses.
- **Email templates live in-repo and must be mirrored to the dashboard.** Supabase hosted projects don't pick up `supabase/config.toml` auth template paths on push — `supabase db push` only moves migrations. The README/runbook captures the manual copy step; the template HTML is the source of truth.
- **K8s "must run" means a single `make up` bootstraps a kind cluster locally.** We don't replace the existing CI/CD pipeline; we add the developer-loop piece that was out of scope in April.
- **Logo is a single SVG primitive, not a Lucide icon import.** One file `public/logo.svg` + one `components/brand/logo.tsx` component. Nav and auth pages import the component; email templates inline the SVG.

---

## Preflight

**Open working-copy state:** the repo may have unstaged design-system work from an earlier session. **Before starting Step 1**, commit or stash this work onto its own branch — do not roll it into any phase of this plan. All phases below assume a clean `main` working copy.

```bash
git status --short          # inspect
git switch -c chore/pre-blueprint-wip   # park current work
git add -A && git commit -m "Checkpoint: design-system WIP"
git switch main
```

---

## Phase 1 — Design system v2: accent palette + logo mark

**Branch:** `design/system-v2-accent-and-logo`
**Model tier:** strongest (this is the anchor for 2, 5, 6, 7 — a sloppy token scheme cascades)
**Context cold-start brief:**

> ayceMon is a Next.js 16 + React 19 app. The design system lives at `DESIGN.md` at the repo root (read it — it's the source of truth). Marketing surfaces are strictly monochrome: `#191C1F` ink on `#FFFFFF` canvas, with `#E23B4A` reserved for destructive only. The user reports the UI is "bland" and wants a new logo plus less-bland colors. You are adding **one** accent color and **one** logo SVG. The accent must not leak into data surfaces (prices, progress bars, charts) — it anchors the brand (logo, wordmark "Mon" suffix, primary CTA hover, win pulse). Preserve every existing type rule, spacing rule, and motion rule. Reviewers will reject changes that turn ayceMon into a Material/generic-startup palette.

### Tasks

1. **Add accent tokens** to `app/globals.css`:

   ```css
   :root {
     /* ...existing... */
     --accent: #F55A2B;            /* persimmon — brand anchor */
     --accent-foreground: #FFFFFF; /* text on accent surface */
     --accent-ink: #8B2D0A;        /* AAA-legible text variant (wordmark) */
     --accent-subtle: rgba(245, 90, 43, 0.10); /* hover wash / win-pulse ring */
   }
   .dark {
     --accent: #FF7A4A;
     --accent-foreground: #191C1F;
     --accent-ink: #FFAD80;
     --accent-subtle: rgba(255, 122, 74, 0.14);
   }
   ```

   And map them into Tailwind v4 theme via the `@theme` block already in that file.

2. **Create the logo mark** at `public/logo.svg` — a chopsticks-and-bowl glyph that works at 24×24 favicon scale and 96×96 marketing scale. SVG must:
   - Use `currentColor` so it inherits `text-foreground` by default.
   - Have an `accent` class slot (`<path class="ayce-logo-accent" fill="var(--accent)">`) for the one-pixel color punch.
   - Be ≤ 2 KB unminified, ≤ 1 KB gzipped. No filters, no gradients, no rasters.

3. **Create the logo component** at `components/brand/logo.tsx`:

   ```tsx
   import type { ComponentPropsWithoutRef } from "react";
   export function Logo({ className, ...rest }: ComponentPropsWithoutRef<"svg">) { /* inline SVG */ }
   export function Wordmark({ className }: { className?: string }) {
     return (
       <span className={className}>
         <span className="font-[var(--font-display)] font-medium tracking-[-0.02em]">ayce</span>
         <span className="font-[var(--font-display)] font-medium tracking-[-0.02em] text-[color:var(--accent-ink)]">Mon</span>
       </span>
     );
   }
   ```

   The wordmark's "Mon" carries the accent — this is the second and last surface where the accent appears in nav. No accent elsewhere in step 1.

4. **Update `components/ui/button.tsx`** — `default` variant gains a persimmon hover layer via `--accent` + `--accent-foreground`. Everything else unchanged. Outline, secondary, ghost, destructive: untouched.

5. **Revise DESIGN.md §2 "Color Palette & Roles"** to:
   - Add a "**Brand Accent (one role)**" subsection to §2 calling out persimmon (`--accent`) and the four (and only four) allowed surfaces: logo mark, wordmark "Mon" suffix, primary CTA hover layer, win-pulse keyframe at peak.
   - Add the three new tokens to the semantic-tokens area.
   - Append the rule "Accent on a price, percentage, or chart element is a bug" to §7 Don'ts.

6. **Revise DESIGN.md §6 "Depth & Elevation"** (and the companion motion block in `globals.css`) — `ayce-win-pulse` now animates a box-shadow ring in `--accent-subtle` outward to transparent in addition to the existing scale. Keep it a single-shot.

7. **Add `public/favicon.svg`** — same logo mark, tuned for 32×32.

### Verification

- `npm run lint` and `npm run build` clean.
- `npm run dev` renders the existing `/setup` page; inspect in the preview tool — nav wordmark shows "Mon" in persimmon, no other UI element uses the accent (prices, progress bars, buttons at rest all still monochrome).
- `diff --stat` shows ≤ 50 changed lines outside `DESIGN.md` — this phase is *additive*, not a rewrite.

### Exit criteria

- DESIGN.md revision reviewed with the "one accent, one role" framing.
- `components/brand/logo.tsx` + `public/logo.svg` + `public/favicon.svg` exist.
- Tokens consumable from Tailwind: `text-[color:var(--accent-ink)]` and `bg-[color:var(--accent)]` compile.
- No component outside Step 1's scope consumes the accent yet.

### Anti-pattern guards

- **Do NOT** add `--accent-2`, `--accent-hover`, `--accent-pressed`. One brand accent. Opacity modifiers via Tailwind (`/80`, `/40`) handle states. (`--accent-ink` is a legibility variant for AAA text, not a state.)
- **Do NOT** replace `--destructive`. Error red stays `#E23B4A` — it's the only other non-neutral and must remain distinguishable from the accent.
- **Do NOT** introduce a purple/blue secondary, a gradient, or a Material-palette chip (orange → pink → blue etc.). The user asked for "less bland"; the answer is **one** carefully-placed color, not a rainbow.
- **Do NOT** ship with pure black (`#000000`) or pure white text on the wordmark. Check contrast at AAA for the wordmark; ink variant required.

---

## Phase 1a — USER APPROVAL GATE

**Hard gate. Do not start Phase 2 until the user has explicitly signed off on:**
- The chosen persimmon hex values (including the `--accent-ink` variant if introduced).
- The logo mark's visual direction.
- The `ayce-win-pulse` motion update.

If the user wants a different persimmon hue, different logo concept, or a different motion feel — iterate in Phase 1 before opening Phase 2.

---

## Phase 2 — Brand rollout

**Branch:** `design/brand-rollout`
**Depends on:** Phase 1a (approval gate)
**Context cold-start brief:**

> Phase 1 added the accent palette, `components/brand/logo.tsx`, and the `Wordmark` component. The current nav (`components/nav.tsx:159`) renders the bare string `ayceMon`. Landing marketing copy in `app/page.tsx` and the auth forms (`components/auth/auth-form.tsx`) also repeat the wordmark. This phase replaces those sites with the branded components and wires the favicon. No new colors — only consume what Phase 1 exported.

### Tasks

1. **Nav:** replace the raw text at `components/nav.tsx:159` with `<Logo className="h-6 w-6" aria-hidden /> <Wordmark className="ml-2 text-base" />`. Keep the underlying `<Link href="/">` anchor and accessibility label.
2. **Landing hero** (`app/page.tsx`): wordmark replaces any `ayceMon` string in the hero block. The large display heading stays untouched (`Space Grotesk` + tracking -0.04em).
3. **Auth forms** (`components/auth/auth-form.tsx`): branded wordmark above the card title.
4. **Favicon:** register `public/favicon.svg` and `public/logo.svg` via `app/layout.tsx`'s metadata — `icons: { icon: "/favicon.svg", apple: "/logo.svg" }`. Next.js 16 handles the rest.
5. **Nav CTA accent:** the "Login"/"Sign up" pill in `components/nav.tsx` gets `default` button variant (already accent-aware after Phase 1) — no extra CSS.
6. **Regression sweep:** grep `text-[#` and `bg-[#` across `app/` and `components/`. Zero hits. Any stragglers get converted to semantic tokens.

### Verification

- Preview the landing page in the dev server; confirm wordmark renders correctly in light and dark mode (use `prefers-color-scheme: dark` or system toggle).
- `npm run build && npm run start` serves favicon at `/favicon.svg`.
- Check three pages at least: `/`, `/setup`, `/tracker` (seed a dummy session via the store for the last one). Accent appears only on wordmark suffix and on button hover.

### Exit criteria

- `rg "ayceMon" app components | grep -v nav\|auth-form\|layout\|page\.tsx` returns only marketing copy strings, no standalone-text nav instances.
- All three pages render without console errors in the preview tool.
- No `#` hex literals added in this phase (only token consumption).

### Anti-pattern guards

- **Do NOT** apply the accent to any price, progress bar, card border, or chart element. If a reviewer finds the accent on a tabular-nums span, the PR goes back.
- **Do NOT** add hover-lift animations beyond the existing `-translate-y-0.5` on Card. This phase is color-token consumption only.

---

## Phase 3 — Branded Supabase auth email templates

**Branch:** `auth/branded-email-templates`
**Depends on:** Phase 1 (logo SVG) — can run in parallel with Phases 2, 4
**BLOCKER:** hosted-project dashboard mirror needs owner creds
**Context cold-start brief:**

> The project uses Supabase Auth (`@supabase/ssr`). Email confirmation on signup currently sends the stock Supabase template ("Confirm your email · Follow this link to confirm your email address"). The user describes this as "scuffed but still works" — meaning links function, presentation is stock. Supabase hosted projects keep email templates in the Dashboard under Auth → Email Templates, *not* in the database. `supabase/config.toml` can carry local templates that are picked up by `supabase start` (local dev) but the hosted project must be mirrored manually. There is currently no `supabase/config.toml` in the repo. This phase adds both: the HTML templates committed in-repo, and a `config.toml` wiring them for local dev, plus a runbook snippet for mirroring to the hosted dashboard.

### Tasks

1. **Create `supabase/config.toml`** — minimal file, auth section only, with `[auth.email.template.confirmation]` etc. pointing to `./email-templates/*.html`. See `supabase init` output for the exact schema.
2. **Write five template HTML files** at `supabase/email-templates/`:
   - `confirmation.html` — signup verification
   - `magic-link.html`
   - `recovery.html` — password reset
   - `invite.html` — collaborator invite
   - `email-change.html`
3. **Template design rules:**
   - 600px max-width table layout — email clients hate flex/grid. Fall back to `<table>` + inline styles.
   - Inline the logo SVG (not `<img src="https://...">`) so it renders offline.
   - Use the Phase 1 accent on the CTA button `background-color: #F55A2B; color: #FFFFFF;`. One accent, one button.
   - Dark-mode support via `@media (prefers-color-scheme: dark)` + Apple Mail/Outlook fallback using `[data-ogsc]`.
   - Use the Supabase substitution tokens: `{{ .ConfirmationURL }}`, `{{ .Token }}`, `{{ .SiteURL }}`, `{{ .Email }}`. Preserve them exactly — Supabase does naive string replacement.
4. **Add the runbook** to `README.md` (or a new `docs/auth-email.md` if the README is getting long): a 4-step mirror procedure ("1. Copy `supabase/email-templates/confirmation.html`. 2. Paste into Dashboard → Authentication → Email Templates → Confirm signup. 3. Replace the subject with `Confirm your ayceMon account`. 4. Save.").
5. **Optional but recommended — document SMTP upgrade.** Do **not** commit SMTP credentials.
6. **Test locally** if `supabase` CLI + Docker are available.

### Verification

- Each template renders in both Gmail (web + iOS) and Apple Mail.
- Tokens `{{ .ConfirmationURL }}` etc. appear once per template, correctly placed.
- The CTA button passes AAA contrast against the email card background.
- After mirroring to the hosted dashboard, sign up with a fresh email → receive the branded template, not the Supabase stock.

### Anti-pattern guards

- **Do NOT** use external CSS — inline every style.
- **Do NOT** include tracking pixels or third-party fonts.
- **Do NOT** commit a populated `smtp.password` — Dashboard-only.
- **Do NOT** hardcode URLs; use `{{ .SiteURL }}`.

---

## Phase 4 — `listContributors` server action + contributors endpoint

**Branch:** `shared-session/contributors-endpoint`
**Depends on:** — (fully parallel with Phases 1–3)
**Context cold-start brief:**

> The shared-session polling hook (`lib/use-shared-session.ts`) fetches `/api/shared-session/[id]` every 2.5s and returns `{ session, items, entries, collaborators }`. This phase extends the hook (rather than bolting on a sibling endpoint) to expose a per-user aggregation: for each collaborator, sum `units × item.alaCarteValue`, total grams, and entry count. Reuse the existing poll heartbeat — do not open a second poller.

### Tasks

1. **Extend `useSharedSession`** to compute a `contributors: LiveContributor[]` array from the already-polled `entries + items + collaborators` data. No new endpoint. No new server action. Pure derivation on the client.

   ```ts
   export interface LiveContributor {
     userId: string;
     displayName: string;
     role: "owner" | "collaborator";
     valueEaten: number;
     grams: number;
     unitCount: number;
     lastLoggedAt: string | null;
   }
   ```

2. **(Optional) REST wrapper** at `app/api/shared-session/[id]/contributors/route.ts` — only add this if an external consumer (mobile, debug tool) actually needs it. Skip for now.
3. **Unit tests** at `lib/use-shared-session.contributors.test.ts`:
   - Happy path: two users, three items, verify per-user totals.
   - Empty-collaborator case (owner only, no entries) returns exactly one row with zero totals.
4. **Types export:** Re-export `LiveContributor` from `lib/types.ts` so client code can import it.

### Anti-pattern guards

- **Do NOT** bolt on a sibling endpoint if derivation from existing poll data suffices — simpler surface.
- **Do NOT** store `valueEaten` on `shared_session_entries` or any new table. It's always derived.
- **Do NOT** open a realtime subscription.

---

## Phase 5 — Per-person cost breakdown panel

**Branch:** `tracker/contributors-panel`
**Depends on:** Phase 2, Phase 4
**SERIALIZED with Phases 6 and 7** — all three edit `app/tracker/page.tsx`.

### Tasks

1. **Create `components/tracker/contributor-panel.tsx`:**
   - Props: `{ contributors: LiveContributor[], buffetPrice: number, selfUserId: string | null }`.
   - Layout: grid of mini-cards. Each card uses existing Card primitives with a compact padding override (`p-4`).
   - Per row: name (`text-sm font-medium`, with "(you)" suffix and `text-[color:var(--accent-ink)]` **on the "(you)" suffix only**), `valueEaten` (`text-xl tabular-nums`), grams (`text-xs text-muted-foreground`), progress bar (monochrome).
   - Fair-share target = `buffetPrice / contributors.length`. Row is flagged with an "Over share" pill (using `variant="secondary"` badge, no red).
2. **Wire into `/tracker`.** Reserve these JSX mount anchors for Phases 6 and 7:
   - `{/* @mount:activity-feed */}` — below the contributor panel
   - `{/* @mount:join-toast */}` — inside the shared-session branch at the top
3. **Accessibility:** section `aria-label="Per-person totals"`, `<ul role="list">`, live region `aria-live="polite"`.
4. **Empty state:** render nothing.

### Anti-pattern guards

- **Do NOT** rank contributors by spend (no "leaderboard").
- **Do NOT** compute per-person splits into owed-amounts.
- **Do NOT** add per-row hover-lift or click-to-expand in this phase.

---

## Phase 6 — Per-person activity feed

**Branch:** `tracker/activity-feed`
**Depends on:** Phase 5 (mount anchor reserved)
**SERIALIZED — edits same file as 5 and 7.**

### Tasks

1. **Create `components/tracker/activity-feed.tsx`.** Self-entry row wash uses `bg-[color:var(--accent-subtle)]` — the only accent surface in this phase.
2. **Replace** the `{/* @mount:activity-feed */}` anchor in `app/tracker/page.tsx` with the feed mount.
3. **Collapsible**, default expanded. `sessionStorage` persists toggle.
4. **Empty state:** "No activity yet — be the first to log a bite."

### Anti-pattern guards

- **Do NOT** add "Load more". 20 rows, done.
- **Do NOT** group by user.

---

## Phase 7 — Collaborator-joined toast

**Branch:** `tracker/join-notification`
**Depends on:** Phase 6
**SERIALIZED — edits same file as 5 and 6.**

### Tasks

1. **Create `components/ui/toast.tsx`** primitive.
2. **Create `components/tracker/join-detector.tsx`** — headless roster diff.
3. **Replace** the `{/* @mount:join-toast */}` anchor in `app/tracker/page.tsx`.
4. **Accent use:** 2px left edge of the toast card only.
5. **Auto-dismiss 4s.**

**Invite token policy** (from `reference_session_invites.md` memory): 22-char base64url, single-use, 24h, opaque DB key — not JWT. This phase consumes join events that were already invited through that policy; do not touch token schema here.

### Anti-pattern guards

- **Do NOT** use browser `Notification.requestPermission()`.
- **Do NOT** store toast history.
- **Do NOT** fire on self-join.

---

## Phase 8 — K8s local dev kit

**Branch:** `k8s/local-dev-kit`
**Depends on:** — (fully parallel with all others)

### Tasks

1. **`k8s/kind/config.yaml`** — kind cluster config. On macOS, map `hostPort: 8080`/`8443` (not 80/443) to avoid AirPlay receiver conflict.
2. **`skaffold.yaml`** at repo root — Skaffold dev loop.
3. **`Makefile`** — `make up`, `make down`, `make logs`, `make clean`.
4. **`scripts/k8s-seed-secrets.sh`** — reads `.env.local`, creates `aycemon-secrets` Secret. Hard-fail if `.env.local` is missing.
5. **`k8s/kind/ingress-nginx.yaml`** — pinned upstream manifest.
6. **Update `k8s/README.md`** with `make up` quickstart.

### Anti-pattern guards

- **Do NOT** commit real secrets.
- **Do NOT** mount the host filesystem for "hot reload".
- **Do NOT** hardcode port-forward URLs in the app.

---

## Phase 9 — K8s production hardening

**Branch:** `k8s/production-hardening`
**Depends on:** Phase 8
**BLOCKER:** Let's Encrypt HTTP-01 needs a public domain — can run against staging until the user supplies prod hostname.

### Tasks

1. **cert-manager `ClusterIssuer`** at `k8s/cert-manager/cluster-issuer.yaml`. Do NOT bundle cert-manager CRDs — cluster-scoped infra.
2. **`k8s/ingress.yaml`** — add TLS + `cert-manager.io/cluster-issuer` annotation.
3. **NetworkPolicy audit** — tighten egress to DNS + `*.supabase.co` + `places.googleapis.com` + `*.upstash.io`.
4. **PDB review.** Confirm `minAvailable: 1`.
5. **Secret rotation runbook** at `docs/k8s-runbook.md`.

### Anti-pattern guards

- **Do NOT** bundle cert-manager's own CRDs/Deployment.
- **Do NOT** log secret values in rollout scripts.

---

## Phase 9b — K8s metrics endpoint + ServiceMonitor

**Branch:** `k8s/metrics-endpoint`
**Depends on:** Phase 9 (networkpolicy baseline)
**Split from Phase 9 for reviewability.**

### Tasks

1. **`app/api/metrics/route.ts`** — minimal Prometheus text-format endpoint. Shared-secret header gate.
2. **`k8s/servicemonitor.yaml`** — Prometheus Operator scrape config.
3. **NetworkPolicy** — allow the monitoring namespace.

### Anti-pattern guards

- **Do NOT** expose raw metrics publicly.
- **Do NOT** include user-level metrics (privacy).

---

## Phase 10 — End-to-end verification + README + status banners

**Branch:** `docs/blueprint-closeout`
**Depends on:** all previous phases

### Tasks

1. **End-to-end checklist** — lint/build, docker run, `make up`, branded confirmation email, two-profile shared session, rolling update, HPA under load.
2. **README reorg** — add "Quick start with Kubernetes" + "Collaborative tracking" subsections; link DESIGN.md.
3. **Status banners** `> **Status: COMPLETE** — shipped YYYY-MM-DD.` on this plan + `plans/collab-and-quantitative-appetite.md` + `plans/docker-kubernetes.md`.
4. **Screenshots** at `docs/screenshots/` (≤ 200 KB each).
5. **Update memory** `project_security_review.md` if this plan materially changes the security surface.

### Anti-pattern guards

- **Do NOT** delete earlier plan files.
- **Do NOT** consolidate this plan into `CLAUDE.md` or `AGENTS.md`.
- **Do NOT** mark complete without screenshots.

---

## Appendix A — File manifest

(See phase sections for per-file assignments.)

## Appendix B — Invariants carried forward

From `plans/collab-and-quantitative-appetite.md` (shipped):
- **#14** — Server never trusts client-supplied `user_id` on writes.
- **#16** — Every UI mutation site branches on `sharedSessionId` before dispatch.
- **#17** — Single display component per surface. Phase 5–7 adds three components strictly inside the shared-session branch.

## Appendix C — Non-goals

- Realtime subscriptions
- Bill splitting / Venmo integration
- Push notifications
- Native app
- Multi-language email templates
- Self-hosted Supabase
- Custom auth UI
