# ayceMon — Collaborative Sessions + Quantitative Appetite Model

**STATUS: COMPLETE (2026-04-14)** — all 8 phases merged; plan kept in place (matches `plans/docker-kubernetes.md` convention).

> **Objective:** (1) Let a session owner invite friends, and let those friends log what *they* ate against the shared session. (2) Replace the arbitrary 1–10 fill-factor slider and 1–100 appetite-budget with a **grams-based, research-backed** quantitative model. (3) Let foods be logged by **grams** in addition to units. (4) Block `/result` while the session is still active. (5) Delete the `/import` page now that `session_records.restaurant_id` is nullable (migration `0003`).

**Generated:** 2026-04-13 · **Revised:** 2026-04-14 · **Mode:** branch-per-phase with GitHub PRs (repo is `github.com/DY0810/ayceMon`, current branch `docs/docker-k8s`, main is `main`)
**Base branch:** `main` — every phase branches off `main`, opens a PR, merges before the next dependent phase starts.

---

## Current state as of 2026-04-14 (READ FIRST if you weren't here yesterday)

**Merged to `main`:**
- Phase 0 — PR #4 (design doc)
- Phase 1 — PR #6 (quantitative types + migration `0004`)
- Phase 2 — PR #9 (setup presets + grams-per-unit library input + seed catalog gramsPerUnit)
- Phase 5 — PR #7 (`/import` removed, migrate.ts drops `no_place` branch)

**In review, not merged:**
- Phase 6 — PR #10 on branch `feat/phase-6-shared-sessions`. Contains: migration `0005_shared_sessions.sql`, `app/actions/shared-session.ts` (create/update/addItem/logEaten/finalize), `app/api/shared-session/[id]/route.ts` polling endpoint, `lib/use-shared-session.ts` polling hook, setup-page "Invite friends" toggle, tracker/library branching on `sharedSessionId`, finalize unit tests. Reviewer findings already addressed in commit `17a341f`. **Assume this merges before Phase 3/4 work starts** — every remaining phase in this plan builds on that assumption.

**Remaining work (phases 3, 4, 7, 8):** see revised dependency table below. Phase 3 and Phase 4 are now unblocked the moment Phase 6 merges — they parallelize. Phase 7 still serializes after Phase 3. Phase 8 last.

**Order of operations implication for remaining phases:**
1. Land PR #10 (Phase 6). Rebase `main`.
2. Branch **Phase 3** and **Phase 4** from `main` in parallel. Merge whichever is ready first.
3. Branch **Phase 7** from `main` after Phase 3 merges (tracker + result overlap).
4. Branch **Phase 8** from `main` last.

**Why this matters for any agent executing cold:** Phase 6's code already exists on the `feat/phase-6-shared-sessions` branch. The schema has `appetite_budget_grams`, `grams_per_unit`, `grams` columns; `app/actions/shared-session.ts` already branches on solo/shared and accepts grams; `lib/use-shared-session.ts` polls. **Do not retrofit** any of this. Remaining phases consume it.

---

## TL;DR (read this first)

**What you're building, end-state:**

- Signed-in users start a session and **optionally** invite friends via a share link. Friends authenticate, join, and log their *own* eaten entries against the shared session. Totals are computed across all collaborators; the result breakdown attributes each line to a user.
- Items are defined by **grams per unit** (e.g. "1 piece of nigiri sushi = 25g"). The old `fillFactor: 1–10` integer is replaced. Library still lets you add items by 1-unit or by direct grams; the tracker does the same.
- The "appetite budget" is now **grams of food you can comfortably eat**, defaulting to ~1200g (the lower end of typical adult gastric capacity per Rolls 1998 / Geliebter 1988). Presets: Light 800g / Typical 1200g / Big 1800g / Competitive 2500g.
- `/result` **redirects to `/tracker`** when the current session has no `finishedAt` — the user cannot peek at their "win" mid-meal.
- `/import` is **gone**. Signed-in finishes go straight into `session_records` (with `restaurant_id = null` when no place is resolved — migration `0003` already allows this). Guest finishes on the client buffer get promoted on next sign-in with the same null-restaurant behaviour.

**Phases, dependency graph, parallelism:**

| # | Phase | Depends on | Parallelizable? | Model tier | Status (2026-04-14) |
|---|---|---|---|---|---|
| 0 | Research + design doc for grams-based appetite model | — | no | strongest | **DONE** (PR #4) |
| 1 | Quantitative types + Supabase migration `0004_quantitative_appetite.sql` | 0 | no | strongest | **DONE** (PR #6) |
| 2 | Setup + Library UI: grams-per-unit, mass budget presets | 1 | **‖ with 6** | default | **DONE** (PR #9) |
| 5 | Remove `/import` page + `finishedSessions` flow | — | **‖ with 2, 3, 6** | default | **DONE** (PR #7) |
| 6 | Shared-session schema (`0005_shared_sessions.sql`) + server-persisted active sessions + dual-path in tracker/library | 1, 2 | **‖ with 5** | strongest | **IN REVIEW** (PR #10) |
| 3 | Tracker + Result quantitative display + "+grams" log button **(dual-path: solo Zustand vs shared server-action)** | 2, 6 | **‖ with 4** after 6 merges | default | **TODO** |
| 4 | Gate `/result` on `finishedAt` (redirect guard + nav widening) | 5, 6 | **‖ with 3** after 6 merges | default | **TODO** |
| 7 | Invite / join flow (`0006_session_invites.sql`) + per-user eaten attribution | 6, 3 | no — serializes after 3 (tracker/result overlap) | strongest | **TODO** |
| 8 | Verification: e2e, unit tests, lint / build gates | 3, 4, 5, 6, 7 | no | default | **TODO** |

**Revised parallelism (2026-04-14):** Phase 6 was completed end-to-end in a single branch (schema + server actions + tracker/library dual-path + polling endpoint + finalize tests). That means Phase 3 and Phase 4 both gain a new upstream dependency on Phase 6 — but gain *each other* as peers: the moment PR #10 merges, Phase 3 and Phase 4 can ship in parallel (they touch disjoint files: Phase 3 owns `tracker`/`result`/`calc`; Phase 4 owns `result` redirect guard + `nav.tsx`). Phase 7 still must wait for Phase 3 because both touch the tracker + result pages.

**Migration-number contract (reviewer-flagged C2):** `0004` → Phase 1, `0005` → Phase 6, `0006` → Phase 7. No other phase may reserve a migration slot. If CI detects a collision (two open PRs both adding `000N_*.sql`), the second PR must rebase and renumber.

**File-ownership contract (reviewer-flagged C3):** Only Phase 5 edits `components/nav.tsx` in its merge window. Phase 4 branches from a commit where Phase 5 has already merged to `main`.

**Six footguns this plan specifically guards against:**

1. **Next.js 16 async APIs still bite.** `cookies()`, `headers()`, route `params` are all Promises (see `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`). Every Phase that touches server components, proxy, route handlers, or dynamic segments must read the local docs first and adapt — do not paste internet snippets.
2. **Two budgets on the wire.** During Phase 1 the DB has both `appetite_budget` (legacy 1–100 int) and `appetite_budget_grams` (new numeric). The migration keeps the legacy column (CHECK-constrainted, defaultable) to avoid breaking inflight guest sessions in `finishedSessions[]`. Phase 8 may retire it — **but not before a prod-data audit**.
3. **Quantitative ≠ precise.** The research cites gastric-capacity ranges, not per-person truth. The UI must frame the budget as a *comfort-ceiling target*, not a medical limit. Never claim kcal tracking (we explicitly don't compute calories — see out-of-scope).
4. **Shared-session RLS is subtle.** A collaborator must be able to read the session and its items but can only write their *own* eaten entries. The owner additionally can edit the library. Two separate policies (one for session + items, one for entries) are required — do not collapse them.
5. **Invite tokens are capabilities.** Anyone with the link can join. Mitigations: random 128-bit token, single-use-ish default (revocable), 24h expiry, `session_id` scoping, rate-limited `/api/session/join`. **No sensitive data in the token itself** — the token is an opaque lookup key for `session_invites`, not a JWT.
6. **Grams-budget slider must include a skip/advanced mode.** Forcing everyone to decide their gram budget at session-start will cause drop-off. Preset chips (Light/Typical/Big/Competitive) + "Skip, I'll eyeball it" (sets budget = `Infinity` in the UI, stored as `null`) keeps the friction-free feel of the current app.

**Stack decisions (locked for this plan):**

- Unit system: **grams** only (no kcal, no ounces). Imperial display toggle is out of scope.
- Active sessions for signed-in users migrate to **server-persisted** (`shared_sessions` + `shared_session_entries`). Zustand stays for guest (anon) sessions only. Hybrid during migration.
- Invite delivery: **share link only** (copy-to-clipboard). No email/SMS/QR this plan.
- Per-user attribution: `shared_session_entries.user_id` (nullable for "owner attributed to themselves" is *not* how we do it — owner gets their own user_id like everyone else).
- Gram input widget: plain `<Input type="number" inputMode="numeric">` with unit suffix — no slider, no stepper. Fast typing is the goal.
- Research provenance: short appendix with citations; design doc in `docs/quantitative-appetite.md` (new file, linked from this plan).

**Out of scope (explicit NO):**

- Calorie / macronutrient tracking. We don't touch kcal or protein/fat/carbs.
- Automatic gram estimation from a photo or LLM. Users type grams.
- Real-time websocket sync for shared sessions — polling + server-actions only. Websockets go in a follow-up plan.
- OAuth / magic-link join flows. Invitee must already have an email/password account.
- Active-session cross-device sync for *solo* users. Signed-in solo users get opt-in shared mode via the invite flow; solo no-invite stays on the existing Zustand buffer unless Phase 6 says otherwise.

**Where to look if you're executing a single phase cold:** jump to the phase heading. Each phase has `Context brief`, `Files to touch`, `Tasks`, `Verification`, `Exit criteria`, and `Anti-patterns`. Appendix A collects the research citations; Appendix B lists the plan-wide invariants the reviewer will check after every phase.

---

## Pre-flight (read before any phase)

### Repo + tooling state (2026-04-13)

- **Stack:** Next.js 16.2.3 (App Router), React 19.2.4, TypeScript strict, Tailwind v4, shadcn/ui (Dialog, Slider, Input, Progress, Card), Zustand 5 with `persist → localStorage` (key `ayce-mon-storage`), Supabase (auth + Postgres + RLS) via `@supabase/ssr`, Google Places API (New).
- **Auth:** email + password only; `lib/auth/require-user.ts` redirects to `/login`. `components/nav-server.tsx` is a server component that passes `signOutAction` down.
- **State:** single active `Session` in Zustand (`lib/store.ts`). Finished sessions land in `finishedSessions[]` waiting for guest→user migration via `app/actions/migrate.ts#promoteGuestSessions`.
- **DB:** migrations `0001_init.sql`, `0002_rls_perf_fixes.sql`, `0003_nullable_restaurant.sql`. Tables: `restaurants`, `session_records`. Views: `user_stats`, `restaurant_stats`. RLS is per-user on `session_records`.
- **Tests:** `vitest` unit tests (`lib/*.test.ts`), Playwright e2e (`e2e/`) — `playwright.config.ts` + `vitest.config.ts`. Lint via `eslint` (config `eslint.config.mjs` with `no-explicit-any: error`).
- **CI:** GitHub Actions (`.github/workflows/*`) builds Docker image and pushes to GHCR on `main` — see `PLAN.md` and `plans/docker-kubernetes.md`.
- **Git:** `main` protected; feature branches merged via PR. `gh auth status` ✅; repo `DY0810/ayceMon` (private).

### Mandatory pre-work on every phase

Per `AGENTS.md`: **read the relevant guide in `node_modules/next/dist/docs/` before writing any Next.js code** — APIs differ from training data. Every phase that writes server components, route handlers, server actions, proxy code, or dynamic route segments must grep/read the local docs and cite which doc in its verification checklist.

### Three Next.js 16 breaking changes to keep in mind

1. **`proxy.ts` (not `middleware.ts`).** Already done in this repo (`proxy.ts` exists). Don't recreate.
2. **`cookies()`, `headers()`, `params` are async.** `await cookies()`, `const { id } = await params`. Any internet snippet using the sync form is wrong.
3. **`useSearchParams()` needs `<Suspense>` in Next 16** when used in a client boundary that may be statically rendered. Invite-join landing page (Phase 7) will hit this.

### Cold-start prerequisites (every phase)

A fresh agent executing any phase must verify before the first commit:

- `gh auth status` returns logged-in (this repo's PR workflow needs it — reviewer-flagged m5). If not logged in, pause and ask the user to run `gh auth login`; do not try to bypass with `git push` alone.
- `supabase --version` resolves (devDependency) — needed for local migration testing.
- Local `.env.local` has `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_PLACES_API_KEY`.

### Branching / PR workflow for each phase

```
git checkout main && git pull
git checkout -b feat/<phase-slug>
# ... work ...
git push -u origin feat/<phase-slug>
gh pr create --base main --title "..." --body "..."
# after review + CI green: gh pr merge --squash --delete-branch
```

---

## Appendix A — Research citations for the quantitative appetite model

These are the sources the design doc in Phase 0 must cite verbatim. The numbers feed directly into the default budget presets.

| Fact | Source | Relevant number |
|---|---|---|
| Average resting gastric volume (healthy adults) | Geliebter A. et al., *Physiology & Behavior* (1988), "Gastric capacity, gastric emptying, and test-meal intake in normal and bulimic women" | Men ≈ 1100 mL, Women ≈ 900 mL at comfortable fullness; up to ~3000 mL at max distension. |
| Volume/mass is a stronger satiety signal than kcal | Rolls BJ et al., *American Journal of Clinical Nutrition* (1998), "Volume of food consumed affects satiety in men" | Same-kcal meals with greater volume/mass produced significantly more satiety. |
| Competitive eater gastric capacity | Levine MS et al., *American Journal of Roentgenology* (2007), "Competitive speed eating: truth and consequences" | Up to 4 L during training sessions (outliers; not a target). |

**Budget-preset provenance (reviewer-flagged M5):** the 800/1200/1800/2500 g buckets derive from Geliebter 1988 (comfort ceiling ≈ 900–1100 g, max ≈ 3000 g) and Levine 2007 (outlier-trained ≈ 4 L). The "Typical 1200g" is a round number just above the Geliebter comfort ceiling, *not* a per-meal population median. If Phase 0 wants to cite a per-meal intake source, the author must pull the actual NHANES "What We Eat in America" per-meal figure themselves rather than re-using an unverified number — do not cite NHANES without verifying the per-meal (not per-day) statistic yourself.

**Output artifact:** `docs/quantitative-appetite.md` — single page citing these sources and explaining the preset buckets.

---

## Appendix B — Plan-wide invariants (reviewer checklist)

After every phase, the review sub-agent must verify these still hold. These are the adversarial anti-pattern guards:

1. `lib/calc.ts` remains the single source of truth for session math. Never duplicate totals computation elsewhere.
2. Server actions validate every client-supplied primitive (type + range). They are public endpoints — treat them like any other API handler.
3. Only `googlePlaceId` is trusted from the client for restaurant resolution. Name/address/lat/lng are re-fetched from Places Details server-side.
4. `admin` client (`lib/supabase/admin.ts`) is used **only** for the canonical-restaurant upsert. Everything else goes through the authenticated server client + RLS.
5. RLS policies use `(select auth.uid()) = user_id` (not `auth.uid() = user_id`) to avoid per-row re-evaluation.
6. No `any` — ESLint `no-explicit-any: error` is a hard gate.
7. Every phase that touches Next.js APIs cites the local `node_modules/next/dist/docs/` file it read.
8. `jsonb` session snapshots (`library`, `eaten`) are inserted as JS objects — **never** `JSON.stringify`'d (supabase-js serialises automatically). Note: `lib/store.ts#finishMeal` uses `JSON.parse(JSON.stringify(finished))` as an in-memory deep clone — that is NOT a DB write and is fine.
9. Migrations are additive and reversible where possible. Never drop columns that in-flight Zustand clients depend on.
10. Secrets never leave the server. `SUPABASE_SERVICE_ROLE_KEY` and `GOOGLE_PLACES_API_KEY` are server-only env vars.
11. Every new UI screen works on mobile viewport (375px min) — mobile-first is enforced by the Playwright device profile.
12. `finishedAt: undefined` means "session in progress". Any code path that renders totals as final must check for this (Phase 4 directly; every phase transitively).
13. The grams-based budget is a *target*, not a *hard cap*. Never show error states when the user exceeds it — the UI just shows 100%+ full.
14. Never trust client-supplied `user_id` on shared-session writes. Derive from `auth.uid()` server-side.
15. Invite tokens are single-use-ish: the default is revocable + 24h expiry, and the token is an opaque DB key, not a JWT with session data encoded in it.
16. **Dual-path invariant (added 2026-04-14):** Every mutation site in the UI (log eaten, add library item, update session) MUST branch on `sharedSessionId`. When `sharedSessionId` is set, call the matching `app/actions/shared-session.ts` server action (`logSharedEaten`, `addSharedLibraryItem`, `updateSharedSession`). Otherwise call the local Zustand method (`logEaten`, `addItemToLibrary`, `updateSession`). No mutation may silently skip this branch — that's what produces the "log ate 200g but nothing happened" bug when the user is in a shared session. Read path follows the same rule: when `sharedSessionId` is set, reads come from the polled `useSharedSession(id)` hook; otherwise from the Zustand store selector.
17. **Single display component invariant (added 2026-04-14):** tracker, library, and result each render *one* JSX component that takes the resolved session shape (solo or shared, normalized by the hook). Do **not** fork into `tracker-solo.tsx` / `tracker-shared.tsx`. This was held in Phase 6 — a grep for `sharedSessionId|SharedSession` in `components/` must return zero matches after every phase, **with two intentional carve-outs**: (a) `components/share-drawer.tsx` (added by Phase 7) references `sharedSessionId` because it *only* renders inside the shared branch (it is a shared-only UI affordance, not a display fork of the tracker); (b) `components/nav.tsx` (predates Phase 7; audited and accepted in Phase 8) reads `sharedSessionId` + `sharedSessionFinishedAt` from the store to decide whether to surface the `/result` nav link — the nav is the legitimate junction point between solo and shared flows, and gating it via a hook abstraction would be architecture for its own sake. The invariant is: zero matches in `components/` outside these two files. Future additions must either use the `share-*` / `shared-*` prefix OR be explicitly added to this carve-out list.

---

# Phase 0 — Research + design doc for grams-based appetite model

**Model tier:** strongest · **Parallelizable:** no · **Rollback:** `git revert` the design doc commit; no code changes.

## Context brief (cold start)

The current fill-factor model is arbitrary: `Item.fillFactor: 1–10` ("1 shrimp = 1, whole pizza = 10") and `Session.appetiteBudget: 1–100`. Both are author-picked integers with no empirical basis. The user asked us to make both "more quantitative and research backed".

**Decision already made (to lock in via this doc):** we pivot to **grams of food mass**. Rationale:

- Grams are universally measurable (food scales, nutrition labels, restaurant portion guides).
- Volume/mass is the primary satiety signal in controlled studies (Rolls 1998) — kcal is a weaker correlate of "how full do I feel".
- Gastric capacity is well-characterised in the medical literature in mL (≈ g for food at neutral density).
- Users at buffets can estimate grams per plate trivially ("a plate of KBBQ meat ≈ 150g cooked") where kcal is guesswork.

The alternative (**kcal**) was considered and rejected: per-item kcal varies 10× between fatty and lean foods, which forces us to ship a nutrition database — huge scope creep with no user benefit at this app's use case.

## Files to touch

- `docs/quantitative-appetite.md` (NEW) — the design doc itself
- `plans/collab-and-quantitative-appetite.md` (THIS FILE) — append an addendum linking to the doc

## Tasks

1. Create `docs/quantitative-appetite.md`. The `docs/` directory does not yet exist in the repo root — `mkdir docs` first (reviewer-flagged m4). Sections:
   - **Why grams** — 3 bullets max, cites Rolls 1998 and Geliebter 1988.
   - **Budget presets** — table of 4 buckets (Light 800g / Typical 1200g / Big 1800g / Competitive 2500g) with a line on who each targets.
   - **Per-item grams-per-unit** — guidance on how to estimate, with 6 worked examples (one shrimp ≈ 8g, one piece nigiri ≈ 20g, one slice of pizza ≈ 120g, one KBBQ plate ≈ 150g, one hotpot meat slice ≈ 25g, one spring roll ≈ 40g).
   - **Fullness progress semantics** — grams consumed / grams budget = fullness %. Same math as fill-factor today, just with a defensible unit.
   - **Known limitations** — water content, beverages excluded, individual variation, not medical advice.
   - **References** — the three primary rows from Appendix A (Geliebter, Rolls, Levine). Do not cite NHANES unless the author verifies the per-meal statistic themselves (see Appendix A provenance note).
2. Do not change any code yet. No `Item` type edits, no UI edits.

## Verification

- `ls docs/quantitative-appetite.md` exists.
- File length ≤ 120 lines (keep it a design doc, not a treatise).
- All four citations from Appendix A present and typed exactly.
- Four preset buckets (800 / 1200 / 1800 / 2500) match Phase 2's constants.

## Exit criteria

- PR opened, CI green (only docs changed so build is a no-op), merged to `main`.

## Anti-patterns

- Don't pivot to kcal mid-doc. Decision is locked.
- Don't claim the grams budget is medically prescriptive.
- Don't invent citations. Use the four in Appendix A exactly.

---

# Phase 1 — Quantitative types + Supabase migration `0004`

**Model tier:** strongest · **Parallelizable:** no (blocks Phases 2 and 6) · **Rollback:** revert commit; drop migration via `supabase migration down` or a `0005` reverse migration.

## Context brief (cold start)

We introduce gram-valued fields **additively** so the existing `finishedSessions[]` buffer in clients on disk doesn't explode. Zustand persists the full session shape — adding optional fields is safe; renaming or removing them is not.

## Files to touch

- `lib/types.ts` — add `gramsPerUnit?: number` to `Item`, add `grams?: number` to `EatenEntry`, add `appetiteBudgetGrams?: number | null` to `Session` and `SessionRecord`.
- `lib/calc.ts` — add `computeFullness(library, eaten, budgetGrams): { grams: number; percent: number }` as the single source of truth for the new fullness progress bar. Do NOT delete the existing `fillFactor`-based math yet; Phase 3 does that.
- `lib/store.ts` — `startSession` accepts optional `appetiteBudgetGrams`. `addItemToLibrary` accepts optional `gramsPerUnit`. `logEaten(itemId, units, gramsOverride?)` — new optional third parameter stored on the EatenEntry.
- `lib/supabase/database.types.ts` — regenerate after migration (see verification).
- `supabase/migrations/0004_quantitative_appetite.sql` (NEW):

  ```sql
  -- Additive grams-based fields. Legacy fill_factor columns stay for one release
  -- to let in-flight Zustand clients finish their persisted sessions.

  alter table public.session_records
    add column if not exists appetite_budget_grams numeric(8,2)
      check (appetite_budget_grams is null or appetite_budget_grams between 50 and 10000);

  -- No new columns for item-level grams — the library jsonb already carries
  -- whatever shape we pass. Phase 1 guarantees the client serialises
  -- gramsPerUnit / grams into those blobs; no schema change needed.

  comment on column public.session_records.appetite_budget_grams is
    'Target grams of food mass for the session. NULL = user opted out. Phase retires legacy appetite_budget in a later migration.';
  ```

## Tasks

1. Edit `lib/types.ts` to add the optional fields listed above. Preserve existing fields verbatim. Run `npx tsc --noEmit` after edit.
2. Add `computeFullness` to `lib/calc.ts` — it must handle the mixed case: an `EatenEntry` with `grams` overrides `units * item.gramsPerUnit`; otherwise fall back to that product; if neither is defined, contribute 0 (and log nothing).
3. Add a unit test `lib/calc.test.ts` for the three branches above (grams override, units × gramsPerUnit, neither).
4. Update `lib/store.ts` per above, preserving the existing `logEaten(itemId, units)` two-arg signature (make the third optional).
5. Write migration `0004_quantitative_appetite.sql`. Validate locally with `npx supabase db reset` (uses the Supabase CLI — available via devDependency).
6. Regenerate DB types: `npx supabase gen types typescript --local > lib/supabase/database.types.ts` — commit the diff.
7. Adjust `app/actions/sessions.ts` to pass through `appetiteBudgetGrams`. The validator style in that file is hand-rolled (`typeof`/range checks inside the per-element loops at lines ~75–92), **not** Zod — follow the same style. Extend the `for (const item of input.library)` loop to accept `item.gramsPerUnit` as `undefined | number`-and-finite-and-`>=0`. Extend the `for (const entry of input.eaten)` loop to accept `entry.grams` as `undefined | number`-and-finite-and-`>=0`. Don't persist to the new `appetite_budget_grams` DB column when the incoming value is null — pass through (the column is nullable).

## Verification

- `npm run lint` clean.
- `npx tsc --noEmit` clean.
- `npm test` — new calc tests green.
- `supabase db reset` applies cleanly; `supabase db diff` shows zero drift after types regen.
- `database.types.ts` contains `appetite_budget_grams` on `session_records`.

## Exit criteria

- Migration merged to `main` and applied to the remote Supabase project via `supabase db push`.
- Types build; no call sites reference removed fields.

## Anti-patterns

- Don't remove `fillFactor` or `appetiteBudget` fields in this phase — migration is additive only.
- Don't make `gramsPerUnit` required on `Item`. It must be `?: number`.
- Don't write the migration as a destructive column rename.

---

# Phase 2 — Setup + Library UI: grams per unit + mass budget presets

**Model tier:** default · **Parallelizable:** yes (with 4, 5, 6) · **Rollback:** revert commit. Safe because DB / types already accept optional fields.

## Context brief

Today `app/setup/page.tsx` has an `appetiteBudget` number input (1–100). `app/library/page.tsx` has a Slider for `fillFactor` (1–10). This phase replaces both UIs with grams-centric equivalents while keeping the legacy fields populated for backward compat (zustand persist lives on users' disks).

## Files to touch

- `app/setup/page.tsx` — replace appetite-budget input with preset-chip group + manual override input + "Skip, I'll eyeball it" toggle. Store result in `appetiteBudgetGrams` (null when skipped). Keep writing the legacy `appetiteBudget` field — but **clamped to `[1, 100]`** because `session_records.appetite_budget int check between 1 and 100` is still enforced at the DB. When the user picks "Skip" (grams = null), write legacy `appetiteBudget = 50` (median). When user picks a gram preset, still write a clamped-to-100 fake for the legacy column; do NOT try to derive it from grams.
- `app/library/page.tsx` — inside the add-item Dialog: remove the `Slider` for `fillFactor`; add an `Input` for `gramsPerUnit` (placeholder from seed catalog if known); keep writing `fillFactor` derived as `Math.max(1, Math.round(gramsPerUnit / 30))` capped to 10 for back-compat.
- `lib/seed-catalog.ts` — **additive only**: add `gramsPerUnit: number` on every seed entry. No deletion of `fillFactor`.
- `components/item-suggest-helpers.ts` — include `gramsPerUnit` in the patch returned by `applyPick`.
- `components/item-suggest-helpers.test.ts` — test new field.

## Tasks

1. Build the preset-chip group component inline in `setup/page.tsx` with values from Appendix A (800/1200/1800/2500). Each chip is a button with `aria-pressed` state.
2. Add a **"Skip, I'll eyeball it"** toggle button that clears the selected preset and sets `appetiteBudgetGrams = null`. In that mode, hide the manual-override input.
3. Library dialog: `<Input type="number" inputMode="numeric" min={1} max={1000} step={1}>` for grams-per-unit, with a `g` suffix label to the right. Placeholder uses the seed-catalog hint.
4. Populate `gramsPerUnit` on all seed entries. Use the Appendix A worked examples as ground truth and extrapolate — **this must be a single focused commit**, reviewable independently. Spot-check 20 entries.
5. Update all tests that assert a `fillFactor` field so they pass with the derived value. Add new tests for the `gramsPerUnit` → `fillFactor` derivation.

## Verification

- Playwright manual smoke: open `/setup`, pick "Typical (1200g)", confirm store has `appetiteBudgetGrams: 1200`. Open `/library`, add an item with grams = 150, confirm store has `gramsPerUnit: 150` and `fillFactor: 5` (derived: `round(150/30) = 5`).
- `npm run lint && npm test` green.
- Mobile viewport (375px) renders presets without overflow.

## Exit criteria

- PR merged, manual QA on `/setup` and `/library` done.

## Anti-patterns

- Don't remove the legacy `fillFactor` field writes. Phase 3 reads it as a fallback for old items.
- Don't block submit if the user picked "Skip". `null` budget is valid.
- Don't invent seed `gramsPerUnit` values — they must be sanity-checkable.

---

# Phase 3 — Tracker + Result quantitative display + `+grams` log button (dual-path)

**Model tier:** default · **Parallelizable:** yes with Phase 4 (disjoint files) once Phase 6 merges · **Rollback:** revert commit.

## Context brief (cold start, revised 2026-04-14)

Phase 6 (PR #10) already introduced the dual-path skeleton in `app/tracker/page.tsx` and `app/library/page.tsx`: both pages check `sharedSessionId` (from the Zustand store) and, when set, read from `useSharedSession(id)` and write through `app/actions/shared-session.ts`. Solo-mode reads from Zustand and writes `store.logEaten(...)`.

What Phase 6 *did not* do:

- It did not add the quantitative **grams display** (the tracker still shows the old `Fill: unitsConsumed / appetiteBudget` UI).
- It did not add the **`+g` inline grams input**.
- It did not update `app/result/page.tsx` at all (still shows units-only breakdown, no grams column, no fullness row).

This phase lands both: the display change + the new `+g` button. Every mutation and every read must respect the dual-path invariant (Appendix B #16).

### Pre-flight sanity checks (run before the first edit)

```
grep -rn "sharedSessionId" app/tracker app/library app/result lib components | head -40
grep -rn "useSharedSession" lib app | head -20
grep -rn "logSharedEaten\|addSharedLibraryItem" app | head -20
ls app/api/shared-session/\[id\]/route.ts lib/use-shared-session.ts app/actions/shared-session.ts
```

If any of those files are missing, **stop** — PR #10 has not merged yet. Do not start Phase 3.

If `components/` has any matches for `sharedSessionId` or `SharedSession*`, the single-display-component invariant (Appendix B #17) has been broken — halt and escalate.

## Files to touch

- `app/tracker/page.tsx` — swap Fill → grams display; add `+g` button per item; branch writes on `sharedSessionId`.
- `app/result/page.tsx` — add grams column + fullness summary row; does not need dual-path writes (read-only), but the read path must already correctly resolve the finalized session (Phase 6's `finalizeSharedSession` aggregates `shared_session_entries` → `session_records` jsonb with `grams` preserved — rely on that, don't recompute).
- `lib/calc.ts` — only edit if `computeFullness` is missing a branch; Phase 1 already added it. Do NOT fork it.
- `lib/store.ts` — **no change needed**; `logEaten(itemId, units, gramsOverride?)` was added in Phase 1.
- `app/actions/shared-session.ts` — **no change needed**; `logSharedEaten(sessionId, itemId, units, grams?)` was added in Phase 6. Verify with `grep "logSharedEaten" app/actions/shared-session.ts`.

## Tasks

1. **Replace the Fill dt/dd in tracker (mobile + desktop).** Compute `gramsConsumed` via `computeFullness(library, eaten, budgetGrams)` from `lib/calc.ts`. Render `formatGrams(gramsConsumed)` and, when `appetiteBudgetGrams != null`, ` / formatGrams(appetiteBudgetGrams)`. When null, show the number alone. Keep the progress bar; drive it off `gramsConsumed / appetiteBudgetGrams` (clamped to [0,1] for the bar width; the numeric label can exceed 100%).
2. **Add a `+g` button per item card.** The visual pattern matches the existing `−1 / +0.5 / +1` row. Tapping it reveals an inline controlled input (a local `useState` on the item card is fine; do not mount a Dialog — the shadcn Popover is not in `components/ui/` yet and adding it is out of scope). Submitting calls the dual-path mutation:

   ```ts
   // pseudocode inside the item card
   if (sharedSessionId) {
     await logSharedEaten(sharedSessionId, item.id, 0, grams);
   } else {
     logEaten(item.id, 0, grams);
   }
   ```

   The `units: 0, grams: N` shape is contractually supported — Phase 1's `EatenEntry` allows `grams` independently of `units`, and Phase 6's `logSharedEaten` accepts the same.
3. **Focus management:** after a successful `+g` submit, close the inline input and refocus the `+g` button on the same card. `useRef<HTMLButtonElement>` inside the card; call `.focus()` in a microtask after the state collapses. Do NOT `useEffect` with a timeout — that ships a race condition.
4. **Add `formatGrams(n)` helper** in `app/tracker/page.tsx` alongside `formatUnits`. Keep it local; if `app/result/page.tsx` needs the same, duplicate — it's 5 lines. Only extract to `lib/format.ts` if a third site needs it.
5. **Result page fullness summary.** Inside `app/result/page.tsx`, after the totals card, render "Fullness: {formatGrams(gramsConsumed)}{budget ? ` of ${formatGrams(budget)}` : ''}". Reuse `computeFullness`. For a finalized shared session, `library` and `eaten` are already the flattened jsonb on `session_records` (per Phase 6 `finalizeSharedSession`). The result page does not need to branch on `sharedSessionId`; it renders whatever the session payload contains.
6. **Result breakdown table — grams column.** Append a column after "Units". Value: `entry.grams` when set; else `entry.units * item.gramsPerUnit` when the item has it; else `—`. Never render `0g` when the grams source is undefined — that's a silent data-loss signal.
7. **Do not touch `components/nav.tsx`** — Phase 4 owns it.
8. **Do not widen `NavVisibility`** — Phase 4 owns that too.

## Verification

- Dual-path grep (copy/paste): `grep -n "logEaten\|logSharedEaten" app/tracker/page.tsx` must show both, each inside a branch on `sharedSessionId`.
- `grep -n "sharedSessionId" components/` must still return zero lines (invariant #17).
- Solo smoke: start a guest session, set budget 1200g, add a library item (150g/unit), go to tracker, tap `+g` → 200. Progress bar updates.
- Shared smoke: sign in, create session with "Invite friends" mode, land on tracker (`sharedSessionId` now set). Tap `+g` → 200. Poll hook should reflect the entry on next refresh (≤3s).
- Result page: finalize both flows, verify grams column populated; fullness row renders with denominator when budget set, without when `null`.
- `npm run lint && npm test && npx playwright test e2e/tracker*.spec.ts` all green.

## Exit criteria

- PR merged. Both solo + shared smoke flows recorded in PR body (screenshot or 10-line description).
- No regression in existing `e2e/` suite.

## Anti-patterns

- Don't recompute `gramsConsumed` inline; call `computeFullness` from `lib/calc.ts`.
- Don't remove the `−1 / +0.5 / +1` buttons — users still want the quick-tap flow.
- Don't show "0g" when grams is unknown; show `—`.
- Don't write a new mutation path that skips the `sharedSessionId` branch (Appendix B #16).
- Don't fork the tracker into `tracker-solo.tsx` / `tracker-shared.tsx` (Appendix B #17).
- Don't add a shadcn Popover component just for the `+g` input. Inline state is fine.

---

# Phase 4 — Gate `/result` on `finishedAt` + widen NavVisibility

**Model tier:** default · **Parallelizable:** yes with Phase 3 (disjoint files: Phase 3 owns `tracker`/`result` body; Phase 4 owns `result` redirect guard + `nav.tsx`) · **Rollback:** revert commit.

## Context brief (cold start, revised 2026-04-14)

Phase 5 merged (PR #7) — `/import` is gone, `components/nav.tsx` no longer has the `/import` `<li>`. That unblocks this phase: editing `nav.tsx` is now safe.

Phase 6 (PR #10) introduced `sharedSessionId` on the Zustand store and a polled `useSharedSession` hook. For shared sessions, "finished" means `sharedSession.finishedAt != null` (from the polled payload). For solo sessions, it means `session.finishedAt != null` (from Zustand). The redirect guard and the nav visibility rule must handle both.

Today (after Phases 2+5+6) `/result` still renders whether or not the session is finished. That's the "peek at the answer mid-meal" bug.

## Files to touch

- `app/result/page.tsx`
- `components/nav.tsx`

## Tasks

1. **Redirect guard in `app/result/page.tsx`.** After the `hasHydrated` guard (the existing `session === null` check is preserved), add:
   ```ts
   // Solo path: Zustand session in progress
   if (session !== null && !session.finishedAt) {
     router.replace("/tracker");
     return null;
   }
   // Shared path: owner or collaborator viewing a shared session that hasn't finalized
   if (sharedSessionId && sharedSession && !sharedSession.finishedAt) {
     router.replace("/tracker");
     return null;
   }
   ```
   Source the shared session from `useSharedSession(sharedSessionId)` (Phase 6 hook). Guard against the polling hook's loading state — redirect should only fire when we have a confirmed `finishedAt === null`, not during the first render before data arrives. Use `if (sharedSession === undefined) return null;` as a loading gate ahead of the redirect.
2. Document (don't change) the existing `session === null` branch — it already redirects to `/setup`.
3. **Widen `NavVisibility`** in `components/nav.tsx`:
   ```ts
   type NavVisibility = "always" | "in-session" | "authed" | "session-finished";
   ```
   Add the new case to the `isVisible` switch. Assign `"session-finished"` to the `/result` nav item.
   **Truth table (reviewer-flagged C1) — `/result` visible iff any of:**
   - Solo: `session != null && session.finishedAt != null` (finished-draft, pre-save)
   - Shared: `sharedSessionId != null && sharedSession?.finishedAt != null`
   Four-state resolution for the link:
   - (guest, no session) → hidden
   - (guest or shared-collaborator, in-progress) → hidden
   - (guest or shared, finished draft) → visible
   - (signed-in, no active session, finished record in DB) → hidden; `/history/[id]` covers that view.
   The nav reads `sharedSessionId` + `sharedSession.finishedAt` via `useSharedSession` — or (preferred to avoid a second poll in the nav) adds a narrow boolean `finished` to the Zustand mirror `sharedSession` field that the tracker already polls and updates. Choose whichever avoids duplicating the polling hook at the nav level.
4. **Playwright test** `e2e/result-gate.spec.ts` covering four cases:
   - Solo in-progress → `/result` redirects to `/tracker`.
   - Solo finished → `/result` stays on `/result`.
   - Shared in-progress (owner) → `/result` redirects to `/tracker`.
   - Shared finished (after `finalizeSharedSession`) → `/result` stays on `/result`.

## Verification

- Manual solo: hit `/result` mid-meal, land on `/tracker`. Finish meal, hit `/result`, land on `/result`.
- Manual shared: invite-mode session, hit `/result` mid-meal, land on `/tracker`. Finalize, hit `/result`, see results.
- `grep -n "NavVisibility" components/nav.tsx` shows the widened union.
- `e2e/result-gate.spec.ts` passes all four cases.

## Exit criteria

- PR merged, e2e green.

## Anti-patterns

- Don't use `useEffect` with a setState for the redirect — call `router.replace` directly inside the existing hook that guards `session === null`.
- Don't change the `/setup` redirect behaviour. The new gate only adds the `finishedAt` check.
- Don't redirect on the shared-session loading state (`sharedSession === undefined`). Wait for data.
- Don't mount the `useSharedSession` polling hook in `nav.tsx` — it renders on every route and will thrash the poller. Derive `finished` from the already-polling tracker's store slice if possible, or accept a small debounce.
- Don't leave the `NavVisibility` switch without a default case — TypeScript's exhaustiveness check is a real guard here (Appendix B #6 `no-explicit-any` friendly).

---

# Phase 5 — Remove `/import` page + `finishedSessions` flow

**Model tier:** default · **Parallelizable:** yes · **Rollback:** revert commit; legacy code stays in git history for reference.

## Context brief

`/import` exists to let signed-in users retroactively attach a Google Place to guest-finished sessions before saving. With migration `0003_nullable_restaurant.sql` already merged, `session_records.restaurant_id` is nullable and we save `restaurant_name` as a fallback. The `/import` prompt is now friction with no upside — guest finishes can go straight to DB with `restaurant_id = null`.

The user wants this page gone.

## Files to touch

- `app/import/page.tsx` — delete
- `app/import/import-client.tsx` — delete
- `components/nav.tsx` — remove the `/import` `<li>` branch
- `components/guest-migration-effect.tsx` — remove the "X still need a restaurant" copy; remove any routing hint to `/import`. Still runs promotion on sign-in.
- `app/actions/migrate.ts` — drop the `no_place` skip branch; sessions without `resolvedPlace` now promote with `restaurant_id = null` + `restaurant_name` fallback (reuse the same path the `finishAndSaveSession` manual-name case uses).
- `lib/store.ts` — **keep** `finishedSessions[]` and `removeFinishedSession` (guest migration still needs this buffer). **Delete** nothing here in this phase.
- Any test references to `/import` — delete.
- Playwright: delete any spec targeting `/import`.

## Tasks

1. Delete `app/import/*`.
2. Remove the `finishedCount > 0` `<li>` from `nav.tsx`.
3. Update `migrate.ts`:
   - When `session.resolvedPlace` is absent, skip the Places fetch + restaurant upsert, set `restaurantId = null`, pass `restaurant_name: session.restaurantName ?? null` on the session_records insert.
   - Update the `MigrateResult.skipped` union to remove the `no_place` reason (inline-delete the filter that checks it).
   - **Behavior-change note (reviewer-flagged M2):** Existing clients with `finishedSessions[]` on disk that were *intentionally* left behind because the user didn't want to resolve a restaurant will now be auto-promoted on next sign-in with `restaurant_name = session.restaurantName ?? null`. The banner (task 4 below) must explicitly say "Imported N meal(s)" — not "Saved" — so the user understands promotion happened silently. Also verify `session.restaurantName` is captured during `/setup` submit (it is today, as optional free-text).
4. Update `guest-migration-effect.tsx` banner copy: only report imported count; drop the "N still need a restaurant" string. Keep the word "Imported" to flag the behavior change to returning users.
5. Grep the repo for `"/import"` and remove every remaining reference (nav, tests, docs).
6. Run `npm run lint && npm test && npm run build` — all green.

## Verification

- `/import` returns 404.
- Guest finishes a session with no Google Place, signs in, sees "Imported 1 meal." banner.
- Session appears in `/history` with the fallback restaurant name.
- No dead imports; grep `promoteGuestSessions.*no_place` returns nothing.

## Exit criteria

- PR merged.

## Anti-patterns

- Don't delete `finishedSessions[]` from Zustand. The guest migration effect still needs it.
- Don't stop re-fetching Places when a `resolvedPlace` *is* set. Only the null path changes.
- Don't remove `0003_nullable_restaurant.sql`. It stays committed.

---

# Phase 6 — Shared-session schema + server-persisted active sessions

**Model tier:** strongest · **Parallelizable:** yes (with 2, 4, 5) · **Rollback:** revert commit; `0005` schema rolled back via `0006` reverse migration.

## Context brief

This is the backbone for Phase 7's invite/join flow. We move the **active** session for signed-in users onto the server so collaborators can write to the same library/eaten state. Guest sessions stay on Zustand.

New tables (migration `0005_shared_sessions.sql`):

- `shared_sessions` — one row per active session. Columns: `id uuid pk`, `owner_user_id uuid fk → auth.users`, `restaurant_id uuid nullable fk → restaurants`, `restaurant_name text nullable`, `buffet_price numeric(10,2)`, `appetite_budget int nullable`, `appetite_budget_grams numeric(8,2) nullable`, `city_tier text nullable`, `resolved_place jsonb nullable`, `started_at timestamptz`, `finished_at timestamptz nullable`, `created_at timestamptz default now()`.
- `shared_session_items` — one row per library item. `(session_id, id, name, ala_carte_value, fill_factor, grams_per_unit, category, source_kind, source_ref)`.
- `shared_session_collaborators` — `(session_id, user_id, role default 'collaborator', joined_at)`. Owner has a row with `role = 'owner'` at creation.
- `shared_session_entries` — eaten entries: `(session_id, user_id, item_id, units, grams, logged_at)`. This is the per-user attribution table.

RLS policies:

- `shared_sessions`: owner or any row in `shared_session_collaborators` with matching `user_id` can `select`. Only the owner can `update` or `delete`. Inserts via authenticated server client with `auth.uid() = owner_user_id`.
- `shared_session_items`: owner only can `insert/update/delete`; any collaborator can `select`.
- `shared_session_collaborators`: owner can `insert`; collaborators can `select`; collaborator can `delete` their own row (leave session).
- `shared_session_entries`: any collaborator can `insert/update/delete` **their own** rows (`auth.uid() = user_id`); owner can `select` all rows; collaborator can `select` rows for their session only.

On `finished_at` set, server action `finalizeSharedSession(sessionId)` promotes the shared session into `session_records` (one row per session, aggregating entries by collaborators into the existing `library`/`eaten` jsonb arrays — flattened — and fills per-user attribution into a new `contributors jsonb` column on `session_records`).

Migration `0005` also adds `contributors jsonb` to `session_records` (default `'[]'::jsonb`).

## Files to touch

- `supabase/migrations/0005_shared_sessions.sql` (NEW)
- `lib/supabase/database.types.ts` (regenerate)
- `lib/types.ts` — add `SharedSession`, `SharedSessionItem`, `SharedSessionEntry`, `SharedSessionCollaborator` types
- `app/actions/shared-session.ts` (NEW) — server actions:
  - `createSharedSession(input)` — insert session + owner collaborator row; return id
  - `addSharedLibraryItem(sessionId, item)`
  - `removeSharedLibraryItem(sessionId, itemId)`
  - `logSharedEaten(sessionId, itemId, units, grams?)`
  - `updateSharedSession(sessionId, patch)` — owner-only field updates
  - `finalizeSharedSession(sessionId)` — sets `finished_at`, aggregates into `session_records`, returns the new record id
- `lib/store.ts` — add optional `sharedSessionId: string | null` to the Zustand state for the active session; when non-null, server is the source of truth and the client polls every 3s via `/api/shared-session/[id]` or re-reads on window focus.
- `app/api/shared-session/[id]/route.ts` (NEW) — GET returns the assembled shared session for a collaborator; used by polling.
- Setup page gets a toggle "Solo" (default) / "Invite friends" (signed-in only). If "Invite friends" is chosen, submit calls `createSharedSession` instead of the local `startSession`.

## Tasks

1. Write the migration. Test with `supabase db reset` locally.
2. Regenerate types.
3. Write all four RLS policies per the matrix above. Use the `(select auth.uid()) = user_id` pattern.
4. Implement the server actions with strict per-field validation (same bar as `finishAndSaveSession`).
5. Add polling or `revalidatePath` calls from server actions so collaborators see updates within ~3s.
6. Implement `finalizeSharedSession` — it reads all entries, computes totals via `computeTotals` + `computeFullness`, inserts a row into `session_records`, sets `finished_at` on the shared session. **Add a dedicated unit test** `app/actions/shared-session.finalize.test.ts` (reviewer-flagged m2) covering: (a) single-collaborator entries aggregate correctly, (b) multi-collaborator entries preserve per-user attribution in `contributors jsonb`, (c) idempotency — calling finalize twice returns the same `session_records.id` and does not duplicate.
7. Setup-page toggle: when solo, no change. When invite mode, submit → `createSharedSession` → router.push(`/tracker?session=${id}`).
8. Tracker + Library + Result pages branch: if `sharedSessionId` set in the store, fetch from `/api/shared-session/[id]` (SWR-ish: poll + refetch on focus) instead of reading `session` directly. **Keep a single display component** that takes the shared shape — this is critical to avoid a fork.

## Verification

- `supabase db reset && supabase db push`.
- RLS policy test: a second user cannot select a shared session they're not a collaborator on.
- Server action validation: invalid inputs reject with `invalid_input`.
- Solo flow still works (no regression in Zustand path).
- `npm run build` clean.

## Exit criteria

- PR merged, shared-session round-trip verified with two signed-in users in a browser.

## Anti-patterns

- Don't use the admin client for anything except the canonical-restaurant upsert. Shared-session writes go through the authenticated client + RLS.
- Don't trust client-supplied `user_id`. Derive from `auth.uid()`.
- Don't `JSON.stringify` the `resolved_place` or `contributors` jsonb on write.
- Don't delete the Zustand path. Guest sessions + solo signed-in sessions still use it.

---

# Phase 7 — Invite / join flow + per-user eaten attribution

**Model tier:** strongest · **Parallelizable:** no — depends on Phase 6 (merged) AND Phase 3 (tracker + result overlap: this phase adds the collaborator list to `app/tracker/page.tsx` and regroups `app/result/page.tsx` by user) · **Rollback:** revert commit; drop `session_invites` table via follow-up migration.

## Context brief (cold start, revised 2026-04-14)

Phase 6 (PR #10) already built the shared-session substrate: `shared_sessions`, `shared_session_collaborators`, `shared_session_entries` tables; `app/actions/shared-session.ts` for create/update/addItem/logEaten/finalize; `lib/use-shared-session.ts` polling hook; `app/api/shared-session/[id]/route.ts` GET endpoint; tracker/library dual-path. **Migration `0005` already includes `grams`, `grams_per_unit`, `appetite_budget_grams` columns** — the grams work was unified with Phase 6.

Phase 3 (the prior phase in order) added the `+g` button + grams display in tracker/result.

This phase adds **only the invite layer**: owner mints a token, invitee accepts via `/join?token=...`, collaborator row is written, UI updates to show "Eating with: Alice, Bob, You".

Sharing URL: `/join?token=xxx`. Invitee:

1. Hits `/join?token=xxx` (client component; reads `useSearchParams()` under `<Suspense>`).
2. If unauth → redirect to `/login?next=/join?token=xxx`.
3. Once signed in → server action `joinSharedSession(token)` looks up the invite, inserts a `shared_session_collaborators` row, deletes or marks the invite used (single-use by default), redirects to `/tracker?session=${sessionId}`.

Tracker UI changes:

- Header shows "Eating with: Alice, Bob, You".
- Per-item card's +1/+0.5/+g buttons still log against the current user.
- Breakdown table on `/result` groups rows by collaborator name with a sub-total per user.

### Pre-flight sanity checks

```
ls app/actions/shared-session.ts lib/use-shared-session.ts app/api/shared-session/\[id\]/route.ts
grep -n "finalizeSharedSession\|logSharedEaten\|createSharedSession" app/actions/shared-session.ts
grep -rn "sharedSessionId" components/  # must be empty (invariant #17)
```

If those fail, Phase 6 has not landed; halt.

## Files to touch

- `supabase/migrations/0006_session_invites.sql` (NEW) — `session_invites (id uuid pk, session_id fk → shared_sessions(id) on delete cascade, token text unique, expires_at timestamptz, created_by uuid fk → auth.users, used_at timestamptz nullable, created_at timestamptz default now())` + RLS owner-only read/write. The `contributors jsonb` column on `session_records` was added in Phase 6's `0005` (verify: `grep contributors supabase/migrations/0005_shared_sessions.sql`); do **not** re-add it here.
- `app/actions/shared-session.ts` — **append** `createInvite(sessionId)`, `joinSharedSession(token)`, `revokeInvite(inviteId)`. Do not touch the existing create/update/addItem/logEaten/finalize actions — they are already review-approved.
- `app/join/page.tsx` (NEW) — **server component** that renders `<Suspense fallback={...}><JoinClient /></Suspense>`. This is the correct Next 16 pattern (reviewer-flagged M4): the `useSearchParams`-caller must be *inside* the Suspense boundary. The `/import` split was removed in Phase 5 so there is no longer a local example to mirror; follow the Suspense-wrapping pattern described in `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md` (cite the exact section in PR body).
- `app/join/join-client.tsx` (NEW) — client component that calls `useSearchParams()` and handles the token exchange.
- `app/tracker/page.tsx` — add Share drawer entrypoint + collaborator list. Collaborator list row sits above the sticky progress bar and only renders when `sharedSessionId != null`. **Do not** fork the tracker; add a conditional JSX block controlled by the same `sharedSessionId` branch Phase 3 left in place.
- `app/result/page.tsx` — group breakdown rows by collaborator. Source of truth: `session_records.contributors` jsonb (populated by `finalizeSharedSession` in Phase 6). For solo sessions, `contributors` is `[]` or absent — fall back to flat rendering from Phase 3.
- `components/share-drawer.tsx` (NEW) — invite link, copy-to-clipboard, revoke, expiry countdown. Single display component — safe because it only renders inside tracker's shared branch; no dual-path concern at this component.
- `lib/invite.ts` (NEW) — `generateInviteToken(): string` — 128-bit (16 bytes) from `crypto.randomBytes`, base64url-encoded (22 chars). No Math.random.

## Tasks

1. Write migration `0006_session_invites.sql` + RLS (owner-only insert/select; collaborator may select their own invite row only to see "used at" diagnostics; nobody but the owner can `delete`). Verify locally: `supabase db reset`.
2. Regenerate types: `npx supabase gen types typescript --local > lib/supabase/database.types.ts`; commit the diff. Confirm `session_invites` appears.
3. Implement `createInvite(sessionId)` — admin-free, authenticated server client. RLS enforces `auth.uid() = created_by`. Returns `{ token, expiresAt }`. Default expiry 24h.
4. Implement `joinSharedSession(token)` — validates token not expired (`expires_at > now()`), not used (`used_at is null`), session not finalized (`shared_sessions.finished_at is null`). Inserts `shared_session_collaborators(session_id, user_id=auth.uid(), role='collaborator')` via authenticated client. Marks invite `used_at = now()` in the same transaction. Rate limit by IP: 10 joins per IP per hour — reuse the `lib/places/rate-limit.ts` pattern. On success return `{ sessionId }`.
5. Implement `revokeInvite(inviteId)` — owner-only. Sets `used_at = now()` without assigning a collaborator. (Soft delete; keeps audit trail.)
6. Build `/join/page.tsx` (server component) + `/join/join-client.tsx` (client). Page wraps `<JoinClient />` in `<Suspense fallback={<JoinLoading />}>`. Client reads `useSearchParams().get("token")`; if unauth, redirect to `/login?next=/join?token=...`; if auth, call `joinSharedSession(token)`. Route outcomes:
   - Success → `router.replace("/tracker")`, store updates `sharedSessionId` via `setSharedSession(sessionId)`.
   - `invite_already_used` / `invite_expired` / `session_finalized` → render a banner with "Ask for a fresh link" CTA.
   - `rate_limited` → banner "Too many joins from this network — try again in an hour".
7. Share drawer UI (`components/share-drawer.tsx`) — triggered from a button in the tracker header. Shows invite link (`${location.origin}/join?token=...`), a copy button, an "Invited so far" collaborator list, and a "Revoke all active invites" button (calls `revokeInvite` for each). Use `navigator.clipboard.writeText` + a shadcn Sonner/toast (or local ephemeral state) on copy.
8. Tracker collaborator-list row (top of page, above sticky progress) — only renders when `sharedSessionId != null`. Pulls from the polled `useSharedSession(id)` hook's collaborators array. Renders "Eating with: Alice, Bob, **You**" (own user always bolded + last).
9. Result page grouping — when `session.contributors?.length > 0`, group `eaten` by user_id and render per-user subheadings with subtotals; otherwise flat (Phase 3 behavior). Per-user subtotal reuses `computeTotals` on that user's slice.
10. **Do not touch `components/nav.tsx`** — Phase 4 owns nav changes.
11. **Do not widen any mutation signatures** — `logSharedEaten`/`addSharedLibraryItem` already ship in Phase 6 with the correct `user_id = auth.uid()` server-derived pattern.

## Verification

- Two-user e2e (`e2e/shared-session-invite.spec.ts`): owner invites, invitee accepts, both log separate items (one via `+1`, one via `+g`), owner calls `finalizeSharedSession`, both see per-user attribution on `/history/[id]`.
- `grep -rn "sharedSessionId\|SharedSession" components/` must still return zero matches other than `components/share-drawer.tsx` (invariant #17 must stand; share-drawer is new and tightly scoped to the shared branch — acceptable per the carve-out in #17).
- Token reuse returns `invite_already_used`.
- Token expiry returns `invite_expired`.
- Session-finalized returns `session_finalized` on join.
- Rate limit blocks 11th join from same IP (unit test in `lib/invite.test.ts` using the same mocked Redis/in-memory store the places-rate-limit suite uses).
- `grep -n crypto.randomBytes lib/invite.ts` present; no `Math.random`.

## Exit criteria

- PR merged; two-user browser walkthrough recorded (or described in PR body).

## Anti-patterns

- Don't encode session data *inside* the token. Token is an opaque DB key.
- Don't allow joining a finished session.
- Don't let a collaborator edit another collaborator's entries (RLS enforces; also guard in server action).
- Don't skip `<Suspense>` around `useSearchParams()` on `/join` — it'll throw in Next 16.

---

# Phase 8 — Verification, tests, polish

**Model tier:** default · **Parallelizable:** no (final) · **Rollback:** revert commit.

## Context brief (cold start, revised 2026-04-14)

Final sweep. By the time this phase starts, Phases 0/1/2/5 are on `main` (merged), Phases 6/3/4/7 are merged too. Job now: round-trip test the full flow, audit Appendix B invariants, decide on the optional `0007_retire_legacy_appetite.sql` migration, tighten anything the prior phases left as TODO, and ship a README update.

## Files to touch

- Playwright specs (create if missing, extend if already exist):
  - `e2e/result-gate.spec.ts` — the 4 cases from Phase 4
  - `e2e/shared-session-invite.spec.ts` — two-user invite/join/log/finalize from Phase 7
  - `e2e/grams-log.spec.ts` — solo `+g` flow + result breakdown grams column from Phase 3
- Unit tests:
  - `lib/calc.test.ts` — confirm `computeFullness` covers all three branches (Phase 1 added the test; verify coverage)
  - `lib/invite.test.ts` — token generation entropy + format + rate-limit path (Phase 7 added it; verify)
  - `app/actions/shared-session.finalize.test.ts` — already in PR #10; re-run as part of the sweep
- Grep sweep targets (dead code removal):
  - `fillFactor` in display-side code (the derivation in seed catalog stays; display references should all route through `computeFullness`)
  - `/import` lingering references
  - `appetiteBudget` mutations outside the legacy-compat clamp in `app/setup/page.tsx`
  - `console.*` in production code paths (allow in tests)
- **Backfill gap to close (audit-flagged 2026-04-14):** `app/actions/migrate.ts` (`promoteGuestSessions`) currently writes `appetite_budget` but **not** `appetite_budget_grams`. Result: any guest session that was created on or after Phase 2 with a grams budget lands in `session_records` with `appetite_budget_grams = null` after sign-in promotion. Phase 1 Task 7 deliberately scoped the validator change to `app/actions/sessions.ts` only, so this is not a Phase 1 violation — but it must be closed here, before any user signs off on `0007` retiring the legacy column. Add a one-line `appetite_budget_grams: session.appetiteBudgetGrams ?? null` to the `SessionRecordsInsert` literal at `app/actions/migrate.ts:104` and extend the migrate validator to accept the optional grams budget with the same range (`50..10000` or null) used in `app/actions/sessions.ts`.
- **Optional** migration `0007_retire_legacy_appetite.sql`: drops `session_records.appetite_budget` **only if** a prod-data audit confirms zero session_records rows have `appetite_budget_grams IS NULL AND finished_at > now() - interval '30 days'` AND the user signs off explicitly. Without that sign-off this migration is **blocked**; record the audit query + result + sign-off quote in the PR body before merging (reviewer-flagged m6). If deferred, open a follow-up tracking issue.

## Tasks

1. Run the full gate: `npm run lint && npm test && npx playwright test && npm run build`. Every gate green on main post-merge.
2. Manually walk the full flow in Chrome desktop + mobile Safari viewport:
   - Solo: setup (grams preset) → library (add item by grams) → tracker (`+1`, `+0.5`, `+g`) → finish → result (grams column + fullness row) → history
   - Shared: sign in → setup → "Invite friends" → share drawer → (second browser) accept invite → both log entries → owner finalizes → both open `/history/[id]` and see attribution
3. Appendix B invariant audit — run each check below:
   - `#1` grep `computeTotals\|totalEatenValue` outside `lib/calc*` → expect all matches to be callers, not redefinitions
   - `#4` grep `createAdminClient` → only in `app/actions/migrate.ts` + Phase 6 finalize path if it used admin (verify it did not)
   - `#5` grep `auth.uid()` in migrations — every predicate should be `(select auth.uid())`
   - `#6` `npm run lint` passes with `no-explicit-any: error`
   - `#8` grep `JSON.stringify` in server actions — zero matches (the one in `lib/store.ts#finishMeal` is allowed per the note)
   - `#13` grep `error\|destructive` in progress-bar renders — no error state when over budget
   - `#14` grep `user_id:` in shared-session insert bodies — must be `auth.uid()` or the authenticated client default, never from the client payload
   - `#16` grep `logEaten\b` — every occurrence paired with a `sharedSessionId` branch
   - `#17` grep `sharedSessionId\|SharedSession` in `components/` — zero matches outside `components/share-*.tsx`
4. Close the **migrate.ts grams backfill gap** (see "Backfill gap to close" above): edit `app/actions/migrate.ts` to (a) accept `appetite_budget_grams` validation in the per-session loop matching `app/actions/sessions.ts`, and (b) include `appetite_budget_grams: session.appetiteBudgetGrams ?? null` in the `SessionRecordsInsert`. Add a unit test under `app/actions/migrate.test.ts` proving promotion preserves the grams budget. This MUST land before any `0007` retire-legacy work.
5. Delete dead code the prior phases flagged with TODOs (if any). One focused cleanup PR (can be the same PR as task 4 if scope stays small).
6. Update `README.md` with: shared-session feature blurb (2–3 sentences), grams-based appetite blurb (1 sentence + link to `docs/quantitative-appetite.md`), screenshot of share drawer.
7. Close out the plan: add a "STATUS: COMPLETE (<date>)" line at the very top. Do **not** move to `plans/done/` — the existing `plans/docker-kubernetes.md` sets the in-place convention.
8. Save post-plan memory entries listed at the bottom of this plan.

## Verification

- All gates green in GitHub Actions CI.
- Zero `console.*` calls in production code (grep).
- README updated.

## Exit criteria

- Final PR merged, plan marked complete.
- If `0007_retire_legacy_appetite.sql` is included in this phase, the PR body contains the prod-data audit result and explicit user sign-off (see Tasks note). Otherwise the migration is deferred.

## Anti-patterns

- Don't retire `appetite_budget` (legacy column) in this phase without a data audit.
- Don't skip the two-user invite e2e test. The core new feature must have coverage.
- Don't add speculative features that the user didn't ask for.

---

## Plan mutation protocol

If a phase turns out wrong mid-execution, prefer:

- **Split:** break a phase into N smaller phases; update the table at the top and add a note under the split phase heading.
- **Insert:** add a new phase between existing ones; renumber ONLY the downstream phases and update the dependency table.
- **Skip:** mark a phase "SKIPPED — reason:" and propagate its non-effect to downstream exit criteria.
- **Abandon:** add an "Abandoned" header and halt. Record why.

Avoid silent reordering — the dependency table is contractual.

---

## Post-plan memory entries to save

On plan finalization (after Phase 8), save:

- A **project** memory noting the grams-based appetite model is the source of truth, with a pointer to `docs/quantitative-appetite.md`.
- A **feedback** memory (if the user re-confirms preferences during execution) about preset-chip UX preferences.
- A **reference** memory for the `session_invites` table — the token format + single-use-by-default policy.

Do not save transient progress; that's for TodoWrite.
