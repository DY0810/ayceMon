# ayceMon — Collaborative Sessions + Quantitative Appetite Model

> **Objective:** (1) Let a session owner invite friends, and let those friends log what *they* ate against the shared session. (2) Replace the arbitrary 1–10 fill-factor slider and 1–100 appetite-budget with a **grams-based, research-backed** quantitative model. (3) Let foods be logged by **grams** in addition to units. (4) Block `/result` while the session is still active. (5) Delete the `/import` page now that `session_records.restaurant_id` is nullable (migration `0003`).

**Generated:** 2026-04-13 · **Mode:** branch-per-phase with GitHub PRs (repo is `github.com/DY0810/ayceMon`, current branch `docs/docker-k8s`, main is `main`)
**Base branch:** `main` — every phase branches off `main`, opens a PR, merges before the next dependent phase starts.

---

## TL;DR (read this first)

**What you're building, end-state:**

- Signed-in users start a session and **optionally** invite friends via a share link. Friends authenticate, join, and log their *own* eaten entries against the shared session. Totals are computed across all collaborators; the result breakdown attributes each line to a user.
- Items are defined by **grams per unit** (e.g. "1 piece of nigiri sushi = 25g"). The old `fillFactor: 1–10` integer is replaced. Library still lets you add items by 1-unit or by direct grams; the tracker does the same.
- The "appetite budget" is now **grams of food you can comfortably eat**, defaulting to ~1200g (the lower end of typical adult gastric capacity per Rolls 1998 / Geliebter 1988). Presets: Light 800g / Typical 1200g / Big 1800g / Competitive 2500g.
- `/result` **redirects to `/tracker`** when the current session has no `finishedAt` — the user cannot peek at their "win" mid-meal.
- `/import` is **gone**. Signed-in finishes go straight into `session_records` (with `restaurant_id = null` when no place is resolved — migration `0003` already allows this). Guest finishes on the client buffer get promoted on next sign-in with the same null-restaurant behaviour.

**Phases, dependency graph, parallelism:**

| # | Phase | Depends on | Parallelizable? | Model tier |
|---|---|---|---|---|
| 0 | Research + design doc for grams-based appetite model | — | no | strongest |
| 1 | Quantitative types + Supabase migration `0004_quantitative_appetite.sql` | 0 | no | strongest |
| 2 | Setup + Library UI: grams-per-unit, mass budget presets | 1 | **‖ with 6** | default |
| 3 | Tracker + Result quant display + "+grams" log button | 2 | no | default |
| 5 | Remove `/import` page + `finishedSessions` flow | — | **‖ with 2, 3, 6** | default |
| 4 | Gate `/result` on `finishedAt` (redirect guard + nav rule) | 5 | no (owns `nav.tsx` after 5) | default |
| 6 | Shared-session schema (`0005_shared_sessions.sql`) + server-persisted active sessions | 1, 2 | **‖ with 5** | strongest |
| 7 | Invite / join flow (`0006_session_invites.sql`) + per-user eaten attribution | 6 | no | strongest |
| 8 | Verification: e2e, unit tests, lint / build gates | 3, 4, 5, 7 | no | default |

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

# Phase 3 — Tracker + Result quantitative display + `+grams` log button

**Model tier:** default · **Parallelizable:** yes (with 4, 5) · **Rollback:** revert commit.

## Context brief

Today `app/tracker/page.tsx` displays `Fill: formatUnits(unitsConsumed) / appetiteBudget` where `unitsConsumed = sum(entry.units * item.fillFactor)`. Replace with grams-based: `formatGrams(gramsConsumed) / appetiteBudgetGrams` where `gramsConsumed = computeFullness(...)`. When `appetiteBudgetGrams === null`, show grams consumed with no denominator.

The tracker's per-item card has `−1 / +0.5 / +1` buttons. Add a fourth inline control: a tiny inline input (or popover) that accepts grams and calls `logEaten(itemId, 0, grams)` — `units: 0, grams: N` lands an EatenEntry with the direct override.

`app/result/page.tsx` shows totals and a breakdown table. Append a column for "Grams" next to "Units", and a "Fullness" summary row next to "Margin".

## Files to touch

- `app/tracker/page.tsx`
- `app/result/page.tsx`
- `lib/calc.ts` (if any helper missing from Phase 1)

## Tasks

1. Replace the `Fill: X / Y` dt/dd in tracker (both mobile + desktop) with grams.
2. Add a `+g` button per item card that opens a tiny inline popover with a number input + Add button. Submit calls `logEaten(item.id, 0, N)`. **Use shadcn/ui** primitives (the repo already ships `components/ui/{dialog,input,button}.tsx`) — do not introduce a Base UI popover component (reviewer-flagged m1). If shadcn's `Popover` isn't yet present, use a `Dialog` triggered from the button, or an inline expand-on-focus `<div>` controlled by local state. The goal is friction-free grams entry, not a new dep.
3. Add a `formatGrams(n)` helper alongside `formatUnits` in the same file (keep the helper local unless it's reused > 2 times).
4. In `result/page.tsx` compute `gramsConsumed` via `computeFullness` and render a new summary line "Fullness: {formatGrams(grams)} {budget ? `of ${formatGrams(budget)}` : ''}".
5. Append a "Grams" column to the breakdown table. Show entry.grams when set; else `entry.units * item.gramsPerUnit`; else `—`.

## Verification

- Tracker on mobile + desktop: grams counter updates on every button tap.
- "+g" popover commits without refreshing the page and focuses the next button afterwards (a11y: `useRef` focus management).
- Result breakdown table renders the grams column for all entry types.
- `npm test` green.

## Exit criteria

- PR merged, both /tracker and /result validated manually.

## Anti-patterns

- Don't recompute `gramsConsumed` inline; call `computeFullness` from calc.ts.
- Don't remove the `−1 / +0.5 / +1` buttons — users still want the quick-tap flow.
- Don't show "0g" when grams is unknown; show `—`.

---

# Phase 4 — Gate `/result` on `finishedAt`

**Model tier:** default · **Parallelizable:** no — owns `components/nav.tsx` for its merge window. Phase 5 must merge to `main` first (reviewer-flagged C3) so the `/import` nav removal doesn't conflict. · **Rollback:** revert commit.

## Context brief

Today `/result` renders the current session whether or not `session.finishedAt` is set. That's the "peek at the answer mid-meal" bug the user reported. Nav also exposes a `/result` link whenever `sessionActive || signedIn`.

## Files to touch

- `app/result/page.tsx`
- `components/nav.tsx`

## Tasks

1. In `result/page.tsx`, after the `hasHydrated` guard, if `session !== null && !session.finishedAt`, `router.replace('/tracker')` and return null.
2. Add a second redirect for the edge case `session === null` (already present) — no change, just document.
3. In `components/nav.tsx`, widen the `NavVisibility` union:
   ```ts
   type NavVisibility = "always" | "in-session" | "authed" | "session-finished";
   ```
   Add the new branch to the `isVisible` switch. Assign it to the `/result` item.
   **Truth table** (reviewer-flagged C1) — `/result` must be visible when any of these is true:
   - `sessionActive && session.finishedAt !== undefined` (draft finished, pre-end-session)
   - `signedIn` with a fresh-ish finished record — *but this doesn't need a nav link*; `/history/[id]` already covers that viewing flow. The link is intentionally hidden for `signedIn && !sessionActive`.
   The four-state resolution: (guest, no-session) hidden; (guest, in-progress) hidden; (guest-or-signed-in, finished-draft) visible; (signed-in, no-session) hidden — use `/history` instead.
4. Add a Playwright test: start session → navigate to /result → expect URL to become `/tracker`. Finish session → navigate to /result → expect URL stays on /result.

## Verification

- Manual: hit `/result` with an in-progress session, land on `/tracker`. Finish meal, hit `/result`, land on `/result`.
- Playwright test added under `e2e/result-gate.spec.ts` and passes.

## Exit criteria

- PR merged, e2e green.

## Anti-patterns

- Don't use `useEffect` with a setState for the redirect — call `router.replace` directly inside the existing hook that guards `session === null`.
- Don't change the `/setup` redirect behaviour. The new gate only adds the `finishedAt` check.

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

**Model tier:** strongest · **Parallelizable:** no (depends on 6) · **Rollback:** revert commit; drop `session_invites` table via follow-up migration.

## Context brief

Owner opens a "Share" drawer from the Tracker; backend mints a random 128-bit token in a new `session_invites` table. Sharing URL: `/join?token=xxx`. Invitee:

1. Hits `/join?token=xxx` (client component; reads `useSearchParams()` under `<Suspense>`).
2. If unauth → redirect to `/login?next=/join?token=xxx`.
3. Once signed in → server action `joinSharedSession(token)` looks up the invite, inserts a `shared_session_collaborators` row, deletes or marks the invite used (single-use by default), redirects to `/tracker?session=${sessionId}`.

Tracker UI changes:

- Header shows "Eating with: Alice, Bob, You".
- Per-item card's +1/+0.5/+g buttons still log against the current user.
- Breakdown table on `/result` groups rows by collaborator name with a sub-total per user.

## Files to touch

- `supabase/migrations/0006_session_invites.sql` (NEW) — `session_invites (id uuid pk, session_id fk, token text unique, expires_at timestamptz, created_by uuid fk → auth.users, used_at timestamptz nullable, created_at timestamptz default now())` + RLS owner-only.
- `app/actions/shared-session.ts` — add `createInvite(sessionId)` and `joinSharedSession(token)`.
- `app/join/page.tsx` (NEW) — **server component** that renders a `<Suspense fallback={...}>` wrapping `<JoinClient />`. This is the correct Next 16 pattern (reviewer-flagged M4): a single client component at the page default export does NOT satisfy the Suspense boundary requirement; the wrapping must be *outside* the `useSearchParams` caller. Mirror the existing `app/import/page.tsx` + `import-client.tsx` split.
- `app/join/join-client.tsx` (NEW) — client component that calls `useSearchParams()` and handles the token exchange.
- `app/tracker/page.tsx` — add Share drawer + collaborator list.
- `app/result/page.tsx` — group rows by collaborator; compute per-user subtotals client-side from the `contributors` jsonb.
- `components/share-drawer.tsx` (NEW) — renders invite link, copy-to-clipboard button, revoke button.
- `lib/invite.ts` (NEW) — `generateInviteToken(): string` (128-bit, base64url).

## Tasks

1. Write migration + RLS.
2. Implement `createInvite` — admin-free, authenticated server client; `auth.uid() = created_by` enforced by RLS.
3. Implement `joinSharedSession` — validates token not expired, not used, session not finished; inserts collaborator; marks invite used.
4. Build `/join` page with `<Suspense>`; extract the `?token=` param; call server action; route on success.
5. Share drawer UI — uses `navigator.clipboard.writeText` and a toast.
6. Tracker collaborator-list row (top of page, above sticky progress).
7. Result page: read `contributors` from `shared_session` (or re-derive from entries before finalize), group breakdown rows by user.
8. Rate-limit `joinSharedSession` by IP (reuse `lib/places/rate-limit.ts` pattern) — 10 joins per IP per hour.

## Verification

- Two-user e2e: owner invites, invitee accepts, both log separate items, owner finalizes, both see attribution on `/history/[id]`.
- Token reuse returns `invite_already_used`.
- Token expiry returns `invite_expired`.
- Rate limit blocks 11th join from same IP.

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

## Context brief

Final sweep. Consolidate unit + e2e tests, deal with the legacy `fillFactor` / `appetiteBudget` columns, and confirm CI is green.

## Files to touch

- New Playwright specs: `e2e/result-gate.spec.ts`, `e2e/shared-session-invite.spec.ts`, `e2e/grams-log.spec.ts`.
- New unit tests: `lib/calc.test.ts` (grams branches), `lib/invite.test.ts` (token generation entropy).
- Grep for lingering references to `/import`, `fillFactor` where it's no longer used display-side, and remove dead code.
- **Optional** migration `0007_retire_legacy_appetite.sql`: drop `session_records.appetite_budget` **only if** a prod-data audit confirms zero rows missing `appetite_budget_grams` AND Appendix B invariant #9 (additive/reversible) is re-evaluated and signed off by the user. Without that sign-off this migration is **blocked**; record the audit result in the PR body before merging (reviewer-flagged m6).

## Tasks

1. Run `npm run lint && npm test && npx playwright test && npm run build`. Every gate green.
2. Manually walk the full flow in Chrome + mobile Safari viewport: solo grams, invite, join, log, finalize, history, stats.
3. Review `Appendix B` invariants for each prior phase. Fix any drift.
4. Open a cleanup PR to delete dead code the prior phases flagged with TODOs.
5. Update `README.md` with the new shared-session + grams feature blurb.
6. Close out the plan by moving it under `plans/done/` (convention check: confirm this dir is or isn't used — adopt whichever matches the existing plans/docker-kubernetes.md pattern; leave in place if none).

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
