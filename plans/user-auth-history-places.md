# ayceMon — User Auth, History, Stats & Restaurant Places Autocomplete

> **Objective:** Introduce user accounts so the site remembers each player across devices; persist every finished session per user; aggregate win/loss records per restaurant and overall; and replace the free-text restaurant name with a Google-Maps-style autocomplete that resolves to a canonical place (so stats can aggregate reliably).

**Generated:** 2026-04-08 · **Mode:** direct (no git repo initialized)
**Base branch / working dir:** `/Users/dyl/ayceMon` (edit in place)

---

## TL;DR (read this first)

**What you're building:** Supabase (auth + Postgres + RLS) in front of the existing Zustand draft buffer; a `/history` + `/stats` pair of server-component pages; and a Google Places (New) autocomplete combobox on `/setup` that resolves a free-text restaurant name into a canonical `place_id`. Guest mode keeps working; finished guest sessions get promoted to the DB on first login.

**Phases (one PR each):**

| # | Phase | Parallelizable? | Model tier |
|---|---|---|---|
| 0 | Read docs, record "Allowed APIs" | no | strongest |
| 1 | Supabase schema + RLS + clients + type additions | no | strongest |
| 2 | Email/password auth + nav user menu | **‖ with Phase 5** | default |
| 3 | `finishAndSaveSession` server action + `/history` | no — needs 2 AND 5 | strongest |
| 4 | `/stats` page + per-restaurant drill-down | no | default |
| 5 | Places API autocomplete combobox | **‖ with Phase 2** | strongest |
| 6 | Guest → user migration on first login | no | default |
| 7 | Verification, tests, polish | no | default |

**Four footguns this plan specifically guards against (each has bitten someone):**
1. **Next.js 16 renamed `middleware.ts` → `proxy.ts`** and made `cookies()`/`params` async. Any Supabase snippet you copy from the internet will be wrong; Phase 0 forces you to read the local Next docs and adapt before pasting.
2. **Don't grant anon `SELECT` on `restaurants`.** The table is seeded with real user-visited places — `using (true)` would leak the dataset. Policy is `to authenticated` only.
3. **Don't trust client-supplied place data.** The server action re-fetches Places Details from the `place_id` alone. Client-supplied `name`/`address`/`lat`/`lng` are rejected — otherwise any signed-in user can pollute the shared restaurants table.
4. **Guest→user migration must be idempotent.** `session_records` has a unique `(user_id, client_session_id)` index; the migration uses `upsert(onConflict: …)`. Retries can't double-insert.

**Stack decisions (locked):** Supabase + `@supabase/ssr`; Google Places API (New) via server-side route handler; email+password only (Google OAuth deferred); no React Query (all history/stats pages are server components); ESLint `no-explicit-any: error` as the type-safety gate.

**Scope note:** Finished sessions sync across devices. Active drafts stay device-local — if you start a meal on your phone, you can't finish it on your laptop. Syncing active drafts is explicitly out of scope.

**Where to look if you just want to execute one phase:** jump to the phase heading below. Each phase is self-contained (context brief → tasks → verification → anti-pattern guards) so a fresh agent can execute it without reading the others. The appendices at the bottom capture the Places billing gotchas and the adversarial-review anti-pattern watchlist.

---

## Context (read before Phase 0)

### Current state (as of 2026-04-08)
- Next.js **16.2.2** (App Router), React **19.2.4**, TS strict, Tailwind v4, shadcn/ui, Zustand v5 with `persist` → `localStorage` (key `ayce-mon-storage`).
- Single active `Session` stored in Zustand (`lib/store.ts`). On "End session" the data is wiped — **no history is kept today**.
- `Session.restaurantName` is an optional free-text string. No geolocation, no place matching.
- Phase 6 of the original `PLAN.md` is complete: happy-path E2E green, mobile-first polish, `npm run build` clean.
- No git repository, no remote, no CI.

### What this plan changes in the original PLAN.md
The original plan lists these as anti-patterns. **This plan formally supersedes them, in this scope only:**
- ❌ → ✅ "Don't introduce a backend, database, or user auth — localStorage only." — **OVERRIDDEN**: we are adding Supabase (Postgres + Auth).
- ❌ → ✅ "Multiple concurrent sessions / history" (out-of-scope in original) — **NOW IN SCOPE**: per-user history + per-location stats.
- ❌ → ✅ "User accounts / cloud sync" (out-of-scope in original) — **NOW IN SCOPE**.

Everything *else* in the original anti-pattern list still holds (no `any`, no photos, no calorie tracking, USD only, etc.).

### Mandatory pre-work on every step
AGENTS.md says: *"This is NOT the Next.js you know… Read the relevant guide in `node_modules/next/dist/docs/` before writing any code."* — Every step below that writes Next.js code **must first** grep/read the relevant local doc (server components, route handlers, proxy, server actions, cookies) from `node_modules/next/dist/docs/` and cite which doc it read in its verification checklist. Never assume an API from memory.

### Known Next.js 16 breaking changes that will bite copy-pasted snippets
These three items invalidate most Supabase `@supabase/ssr` snippets on the internet. Every phase that touches them must adapt, not paste verbatim.

1. **`middleware.ts` → `proxy.ts`.** Next 16 renamed the middleware file convention to `proxy.ts` with an exported `proxy(request)` function. See `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` and `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`. Any Supabase snippet that says "create `middleware.ts`" **must** be adapted to `proxy.ts` + `export function proxy`.
2. **`cookies()`, `headers()`, `draftMode()`, and route segment `params` are async.** They return Promises and must be `await`ed. Older snippets like `const cookieStore = cookies()` will crash at runtime. Always write `const cookieStore = await cookies()`.
3. **Dynamic params on page/layout/route handlers are async.** `params` in `PageProps` / `LayoutProps` / handler signatures is `Promise<{...}>`; unwrap with `const { id } = await params`.

---

## Stack Decisions (locked for this plan)

| Concern | Choice | Why |
|---|---|---|
| Auth + DB | **Supabase** (Postgres + Auth + RLS) | Free tier, first-class Next.js App Router support via `@supabase/ssr`, RLS gives per-user isolation without hand-rolled authorization. Supabase MCP is available in this environment. |
| Postgres version | **≥ 15** (asserted in Phase 1) | `security_invoker` views require PG15+. Supabase projects created after 2023 default to PG15+ but the plan still asserts. |
| Auth methods | **Email+password only in this plan**. Google OAuth is deferred (see Out-of-scope). | Keeps Phase 2 cold-start executable without a human clicking through the Supabase dashboard. OAuth is a separate plan. |
| ORM / query layer | `@supabase/supabase-js` directly (no Prisma) | Simpler, one dependency, works with RLS out of the box. |
| Places autocomplete | **Google Places API (New)** — `places:autocomplete` + `places:getPlace` | User explicitly asked for "just like Google Maps". Session tokens bundle Autocomplete+Details into one billed session *only when Details is actually called*. |
| Places proxy | Next.js Route Handler (`app/api/places/...`) | Keep the API key server-side only. Never ship the Google key to the client. |
| Client state | Zustand only, for the in-progress draft session buffer. | No new client-state lib. React Query is **not** added in this plan — every history/stats page in Phases 3–4 is a server component with direct Supabase calls. |
| Forms | Native HTML + minimal hand-rolled validation (matches existing style in `app/setup/page.tsx`). Do **not** add react-hook-form or zod just for this. | Match existing code. |
| Migrations | Supabase CLI migrations committed under `supabase/migrations/` | Reviewable SQL, idempotent. |
| Testing | Vitest for unit, Playwright for E2E (already installed). Mock Supabase in unit tests; use a Supabase "preview" branch for the E2E. | Existing tools, no new frameworks. |
| Server-only enforcement | `import "server-only"` at the top of every module that must never enter a client bundle. | Build-time failure if a client component imports it — stronger than a grep gate. |

### Env vars (locked names — use these exactly)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=            # server-only, never imported from client
GOOGLE_PLACES_API_KEY=                # server-only, never imported from client
```

---

## New Domain Model (source of truth — paste verbatim into Phase 1)

```ts
// lib/types.ts — additions. Do NOT delete Item / EatenEntry / Session — they still
// power the in-progress session buffer. What changes is that finished Sessions
// are persisted to the DB and tied to a user_id + restaurant_id.

export type UserId = string;       // Supabase auth.users.id (uuid)
export type RestaurantId = string; // our restaurants.id (uuid), NOT the Google place_id
export type SessionRecordId = string;

/** A canonical restaurant, keyed by Google Place ID. Shared across all users.
 *  ALL fields except `googlePlaceId` are populated server-side from the Places
 *  Details API — never from client-submitted data. */
export interface Restaurant {
  id: RestaurantId;           // our internal uuid
  googlePlaceId: string;      // Google's place_id — UNIQUE
  name: string;               // canonical display name from Places
  formattedAddress: string;
  lat: number;
  lng: number;
  createdAt: string;          // ISO
}

/** Added to Session (in-progress draft buffer) in Phase 1, used in Phases 3/5. */
export interface ResolvedPlace {
  googlePlaceId: string;      // the ONLY field the server trusts
  name: string;               // display-only; server re-fetches before persist
  formattedAddress: string;   // display-only
  lat: number;                // display-only
  lng: number;                // display-only
}

/** A finished session belonging to a user. Abandoned sessions do NOT land here. */
export interface SessionRecord {
  id: SessionRecordId;
  userId: UserId;
  restaurantId: RestaurantId;
  clientSessionId: string;    // the draft Session.id from Zustand — idempotency key
  buffetPrice: number;
  appetiteBudget: number;
  library: Item[];            // snapshot at finish time
  eaten: EatenEntry[];        // snapshot at finish time
  totalEatenValue: number;    // denormalized for fast stats
  margin: number;             // totalEatenValue - buffetPrice
  won: boolean;               // totalEatenValue >= buffetPrice
  startedAt: string;          // ISO
  finishedAt: string;         // ISO  (NOT NULL — only finished sessions land in DB)
}

/** Aggregated stats — materialized via a SQL view, not stored. */
export interface UserStats {
  totalSessions: number;
  totalWins: number;
  totalLosses: number;
  totalMargin: number;        // sum of margins across all sessions (can be negative)
  bestMargin: number;
  worstMargin: number;
}

export interface RestaurantStats {
  restaurantId: RestaurantId;
  restaurantName: string;
  sessions: number;
  wins: number;
  losses: number;
  totalMargin: number;
  lastVisitedAt: string;      // ISO
}
```

---

## Locked invariants (verify after every step)

1. `npm run build` succeeds with strict TS.
2. `npm run lint` is clean and the ESLint config has `@typescript-eslint/no-explicit-any: "error"` enabled (Phase 1 turns it on; Phase 7 gates on it).
3. The existing happy-path E2E (`e2e/happy-path.spec.ts`) still passes — anonymous guest mode must continue to work throughout. Phase 7 splits the spec; until then the original spec is untouched.
4. No secrets in client bundles: modules that must stay server-only declare `import "server-only";` on the first line. Client imports of such modules produce a build-time error. Phase 7 adds a second belt via grep over `.next/static/**` for `SERVICE_ROLE` / `GOOGLE_PLACES_API_KEY`.
5. RLS is ON for every user-owned table. Verify with:
   ```sql
   select c.relname, c.relrowsecurity
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('restaurants','session_records');
   ```
6. No new `any` types anywhere (enforced by ESLint per #2, not by grep).
7. **Cross-device sync scope (read carefully):** This plan syncs *finished* sessions across devices. **Active drafts remain device-local** — if you start a meal on your phone and finish on your laptop, you'll need to re-create the draft on the laptop. Syncing active drafts is explicitly out of scope for this plan.

---

## Phase overview & dependency graph

```
Phase 0 (stack verify)
   │
   ▼
Phase 1 (DB schema + types + supabase clients + ResolvedPlace on Session)
   │
   ├─────────────┐
   ▼             ▼
Phase 2       Phase 5        ← THESE TWO RUN IN PARALLEL
(Auth)        (Places)
   │             │
   └─────┬───────┘
         ▼
Phase 3 (persist finished sessions + history) — needs BOTH auth AND places
         │
         ▼
Phase 4 (stats: per-location + total)
         │
         ▼
Phase 6 (guest → user migration on first login)
         │
         ▼
Phase 7 (verification, tests, polish)
```

**Parallelism: after Phase 1 ships, Phase 2 and Phase 5 are independent and can be executed by two sub-agents in parallel.** They do not touch the same files:
- Phase 2 touches `middleware`/`proxy`, `app/(auth)/*`, `components/nav*`, `lib/auth/*`, `app/actions/auth.ts`.
- Phase 5 touches `app/api/places/*`, `components/restaurant-combobox.tsx`, and `app/setup/page.tsx`.

**Phase 3 is NOT parallelizable with Phase 2 or Phase 5** — it depends on both (the signed-in write path needs a resolved place). Phase 3 begins once Phase 2 and Phase 5 are both merged.

`lib/types.ts` and `lib/store.ts` are touched only in Phase 1 for this change (the `ResolvedPlace` field and `setResolvedPlace` action are added there so Phase 5 can write to it and Phase 3 can read from it without either phase racing the other on the same file).

---

## Phase 0 — Stack verification & project bootstrap

**Model tier:** strongest (Opus). This is the "read the docs" step; getting it wrong poisons every later step.

### Context brief (cold-start)
You are adding auth + DB + places to an existing Next.js 16.2.2 App Router app. Nothing has been installed yet beyond what's in `package.json`. Your job in this phase is **only** to verify versions, read docs, and write the "Allowed APIs" note that the rest of the plan references. **Do not install anything yet.** Do not touch source files.

### Tasks
1. Grep `node_modules/next/dist/docs/` for: server components, server actions, route handlers, **proxy** (not middleware — see Known Breaking Changes), cookies, dynamic APIs. Record the exact file paths of the canonical docs in a scratch file `plans/.phase0-notes.md`. Specifically confirm:
   - `proxy.ts` is the file convention (not `middleware.ts`)
   - The signature: `export function proxy(request: NextRequest)`
   - `cookies()`, `headers()`, `draftMode()` are async (return Promises)
   - Dynamic route `params` in PageProps/LayoutProps/handlers are async
2. Read the current `@supabase/ssr` docs via WebFetch from `https://supabase.com/docs/guides/auth/server-side/nextjs`. **Do not paste verbatim** — snippets on that page still use `middleware.ts` and synchronous `cookies()`. Your job here is to record the snippets, then write *adapted* versions in the notes file that:
   - Use `proxy.ts` / `export function proxy(request)`
   - Use `const cookieStore = await cookies()`
   - Await `params` in any example that uses them
   Record the `@supabase/ssr` version you verified against.
3. Read Google Places API (New) docs via WebFetch from `https://developers.google.com/maps/documentation/places/web-service/place-autocomplete` and `https://developers.google.com/maps/documentation/places/web-service/place-details`. Record:
   - Endpoint URLs and HTTP methods
   - Required headers (`X-Goog-Api-Key`, `X-Goog-FieldMask`)
   - The exact SKU tier for the field mask `id,displayName,formattedAddress,location` on Place Details — Essentials vs Pro vs Enterprise. Note the $/1000 rate for each tier.
   - The exact SKU behavior for Autocomplete:
     - When a session token is reused with a subsequent Place Details call: billed as one "Autocomplete Session" SKU.
     - When the user abandons (no Details follow-up): billed **per request** as "Autocomplete (without Place Details)" SKU.
   - Session token lifecycle guidance (token expires after a few minutes or after Details call).
4. Read `node_modules/@base-ui/react/combobox/` — list every exported part (`Combobox.Root`, `.Input`, `.List`, `.Item`, `.Popup`, `.Positioner`, etc.) and record the exact import path (it is `@base-ui/react/combobox`, namespaced, not the package root). Paste a minimal *working* skeleton into the notes for Phase 5 to copy.
5. Run `npx supabase --version` (the npm package is `supabase`, not `@supabase/cli`) to confirm availability. If not installed globally, note the install command for Phase 1: `npm i -D supabase`.
6. Decide and record in `plans/.phase0-notes.md`:
   - Supabase project name: `aycemon-dev`
   - Supabase region: closest to the user (default `us-west-1`)
7. Confirm the Supabase project Postgres version will be ≥ 15 (required by Phase 1's `security_invoker` views).

### Deliverable
`plans/.phase0-notes.md` with a section labeled `## Allowed APIs` containing:
- Next.js 16 doc paths for: proxy, server components, server actions, route handlers, cookies, dynamic APIs
- The **adapted** `@supabase/ssr` snippets for Next 16 (proxy.ts + async cookies)
- Google Places endpoints + field masks + SKU tier for the chosen field mask
- The Base UI combobox skeleton
- All `npm i` commands to be executed in Phase 1 (listed, not run)

### Verification
- [ ] `plans/.phase0-notes.md` exists and has a `## Allowed APIs` block.
- [ ] Each API entry has a URL or local file path next to it. No entry was "remembered" — all were actually read.
- [ ] The notes explicitly contain the Next 16 proxy.ts/async-cookies adapted snippet (not the stale Supabase middleware.ts snippet).
- [ ] The notes contain the exact Base UI combobox exports (not "check if Combobox is the right name").
- [ ] The notes record the SKU tier and $/1000 rate for the chosen Places field mask.
- [ ] No source files under `app/`, `lib/`, `components/`, `package.json` were modified in this phase.

### Anti-pattern guards
- ❌ Don't `npm i` anything yet.
- ❌ Don't create the Supabase project yet.
- ❌ Don't edit `lib/types.ts` — the domain model block in this plan is authoritative; Phase 1 pastes it in.

---

## Phase 1 — Database schema, RLS, and Supabase wiring

**Model tier:** strongest. Schema mistakes at this layer cascade forever.

### Context brief (cold-start)
Phase 0 has produced `plans/.phase0-notes.md` with the exact Supabase and Next.js APIs to use. In this phase you will create a Supabase project, write the initial migration, enable RLS, generate TypeScript types from the schema, and wire up the `createBrowserClient` / `createServerClient` helpers. **No UI changes yet.** Auth sign-in happens in Phase 2.

### Tasks
1. Create a Supabase project via the Supabase MCP tool (`mcp__claude_ai_Supabase__create_project`) with name `aycemon-dev`. Record the project ref in `.env.local` (do not commit). Assert the project's Postgres version is ≥ 15 — if not, fail the step and escalate.
2. Install deps (copy from Phase 0 notes — do not re-derive):
   ```
   npm i @supabase/supabase-js @supabase/ssr server-only
   npm i -D supabase
   ```
3. Turn on the `@typescript-eslint/no-explicit-any` rule in `eslint.config.mjs` (level `error`). Confirm `npm run lint` still passes on the existing codebase.
4. Create `supabase/migrations/0001_init.sql` with this exact schema:
   ```sql
   -- restaurants: canonical, shared across users. Readable only by authenticated
   -- users; writes only happen via the service-role admin client on the server.
   create table if not exists public.restaurants (
     id uuid primary key default gen_random_uuid(),
     google_place_id text not null unique,
     name text not null,
     formatted_address text not null,
     lat double precision not null,
     lng double precision not null,
     created_at timestamptz not null default now()
   );

   -- session_records: finished sessions, per user.
   -- client_session_id is the draft Session.id from Zustand and is the
   -- idempotency key for the guest→user migration (Phase 6).
   create table if not exists public.session_records (
     id uuid primary key default gen_random_uuid(),
     user_id uuid not null references auth.users(id) on delete cascade,
     restaurant_id uuid not null references public.restaurants(id) on delete restrict,
     client_session_id uuid not null,
     buffet_price numeric(10,2) not null check (buffet_price >= 0),
     appetite_budget int not null check (appetite_budget between 1 and 100),
     -- library/eaten are *snapshots* at finish time and may reference a historical
     -- Item shape. All aggregate stats MUST use the numeric columns below,
     -- not these arrays. Future queries over these jsonb blobs must handle
     -- schema drift explicitly.
     library jsonb not null,
     eaten jsonb not null,
     total_eaten_value numeric(10,2) not null,
     margin numeric(10,2) not null,
     won boolean not null,
     started_at timestamptz not null,
     finished_at timestamptz not null,
     created_at timestamptz not null default now()
   );

   create index if not exists session_records_user_id_idx
     on public.session_records(user_id);
   create index if not exists session_records_user_restaurant_idx
     on public.session_records(user_id, restaurant_id);

   -- Idempotency index for Phase 6 guest→user migration.
   create unique index if not exists session_records_user_client_session_uniq
     on public.session_records(user_id, client_session_id);

   alter table public.restaurants enable row level security;
   alter table public.session_records enable row level security;

   -- RLS: restaurants are readable by authenticated users only.
   -- Anonymous clients get zero rows. Writes are blocked entirely for the
   -- authenticated role — the service-role admin client handles all inserts
   -- from the server, AFTER re-resolving the placeId via Places Details (so
   -- name/address/lat/lng are never trusted from client input).
   create policy restaurants_authenticated_read
     on public.restaurants
     for select
     to authenticated
     using (true);

   -- RLS: session_records are strictly per-user.
   create policy session_records_own_read
     on public.session_records for select
     to authenticated
     using (auth.uid() = user_id);
   create policy session_records_own_write
     on public.session_records for insert
     to authenticated
     with check (auth.uid() = user_id);
   create policy session_records_own_update
     on public.session_records for update
     to authenticated
     using (auth.uid() = user_id)
     with check (auth.uid() = user_id);
   create policy session_records_own_delete
     on public.session_records for delete
     to authenticated
     using (auth.uid() = user_id);

   -- Aggregated views (security_invoker — runs as the caller so RLS applies).
   create or replace view public.user_stats
     with (security_invoker = on) as
   select
     user_id,
     count(*)::int as total_sessions,
     count(*) filter (where won)::int as total_wins,
     count(*) filter (where not won)::int as total_losses,
     coalesce(sum(margin), 0)::numeric(12,2) as total_margin,
     coalesce(max(margin), 0)::numeric(12,2) as best_margin,
     coalesce(min(margin), 0)::numeric(12,2) as worst_margin
   from public.session_records
   group by user_id;

   create or replace view public.restaurant_stats
     with (security_invoker = on) as
   select
     sr.user_id,
     sr.restaurant_id,
     r.name as restaurant_name,
     count(*)::int as sessions,
     count(*) filter (where sr.won)::int as wins,
     count(*) filter (where not sr.won)::int as losses,
     coalesce(sum(sr.margin), 0)::numeric(12,2) as total_margin,
     max(sr.finished_at) as last_visited_at
   from public.session_records sr
   join public.restaurants r on r.id = sr.restaurant_id
   group by sr.user_id, sr.restaurant_id, r.name;

   -- Views don't inherit base-table grants. Grant select to authenticated.
   grant select on public.user_stats to authenticated;
   grant select on public.restaurant_stats to authenticated;
   ```
5. Apply the migration via `mcp__claude_ai_Supabase__apply_migration`.
6. Generate TS types: `mcp__claude_ai_Supabase__generate_typescript_types` → write to `lib/supabase/database.types.ts`.
7. Create `lib/supabase/client.ts`:
   ```ts
   "use client";
   import { createBrowserClient } from "@supabase/ssr";
   import type { Database } from "./database.types";
   export const createClient = () =>
     createBrowserClient<Database>(
       process.env.NEXT_PUBLIC_SUPABASE_URL!,
       process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
     );
   ```
8. Create `lib/supabase/server.ts` using the **Phase 0 adapted snippet** (Next 16 async `cookies()`). First line: `import "server-only";`. The client must use `await cookies()` inside the `cookies: { getAll, setAll }` callbacks.
9. Create `lib/supabase/admin.ts` (used in Phase 3) scaffolded now so the import path is stable:
   ```ts
   import "server-only";
   import { createClient } from "@supabase/supabase-js";
   import type { Database } from "./database.types";
   // SERVER ONLY — never import from a "use client" file.
   // Uses the service role key; bypasses RLS. Use only for the restaurants
   // upsert path in the finishAndSaveSession server action (Phase 3), after
   // re-resolving the placeId via Places Details.
   export const createAdminClient = () =>
     createClient<Database>(
       process.env.NEXT_PUBLIC_SUPABASE_URL!,
       process.env.SUPABASE_SERVICE_ROLE_KEY!,
       { auth: { persistSession: false, autoRefreshToken: false } }
     );
   ```
10. Create `proxy.ts` at the repo root (**not** `middleware.ts` — Next 16 rename):
    ```ts
    import type { NextRequest } from "next/server";
    import { updateSession } from "@/lib/supabase/proxy-session";
    export async function proxy(request: NextRequest) {
      return await updateSession(request);
    }
    export const config = {
      matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg)$).*)"],
    };
    ```
    And `lib/supabase/proxy-session.ts` — the Next-16-adapted `updateSession` helper (from Phase 0 notes), using `await cookies()` as needed. Must `import "server-only"`.
11. Update `lib/types.ts` — **add** the new interfaces from the "New Domain Model" block (Restaurant, ResolvedPlace, SessionRecord, UserStats, RestaurantStats). **Also add** `resolvedPlace?: ResolvedPlace` to the existing `Session` interface. Do not delete `Item`/`EatenEntry`/`Session`.
12. Update `lib/store.ts` to:
    - Accept `resolvedPlace?: ResolvedPlace` in `startSession`'s input and store it on the session.
    - Add a new action `setResolvedPlace: (place: ResolvedPlace | undefined) => void`.
    - Add `finishedSessions: Session[]` (persisted) initialized to `[]` — populated by guest `finishMeal()` in Phase 6. For this phase, leave `finishMeal()` untouched; the array just sits there as `[]`.
13. Run `mcp__claude_ai_Supabase__get_advisors` with type `security` and type `performance`. Fix any `ERROR`-level findings before finishing the step.
14. Manual verification query (via `mcp__claude_ai_Supabase__execute_sql` using the anon key context if possible; otherwise just inspect the policies):
    ```sql
    -- must return zero rows as anon
    set local role anon;
    select count(*) from public.restaurants;
    ```

### Verification
- [ ] `npm run build` succeeds.
- [ ] `npm run lint` succeeds with `no-explicit-any: error` turned on.
- [ ] `supabase/migrations/0001_init.sql` applied; `list_tables` shows both `restaurants` and `session_records` with RLS enabled.
- [ ] `pg_class` check (invariant #5) confirms RLS is on for both tables.
- [ ] Anonymous `select count(*) from public.restaurants` returns 0 (not "permission denied", 0 rows under the RLS policy — because anon is not `authenticated`).
- [ ] `grant select` on both views to `authenticated` is present.
- [ ] `lib/supabase/database.types.ts` exists and compiles.
- [ ] `proxy.ts` exists at repo root; `middleware.ts` does NOT exist (`ls middleware.ts` fails).
- [ ] `lib/supabase/admin.ts` and `lib/supabase/server.ts` both begin with `import "server-only";`.
- [ ] `get_advisors` returns zero security-level `ERROR` findings.
- [ ] The existing Playwright E2E (`e2e/happy-path.spec.ts`) still passes — Phase 1 does not change any page behavior.
- [ ] Cite the Next 16 doc file path (for proxy + cookies) in the step's exit notes.

### Anti-pattern guards
- ❌ Don't create `middleware.ts`. It does nothing in Next 16.
- ❌ Don't use synchronous `cookies()`. Always `await cookies()`.
- ❌ Don't grant `select` on `public.restaurants` to anon. Authenticated only.
- ❌ Don't use `security definer` on the views — use `security_invoker`.
- ❌ Don't skip the `grant select` on the views — without it, `select * from user_stats` as `authenticated` returns "permission denied" and Phase 4 silently breaks.
- ❌ Don't embed business logic in SQL triggers — keep logic in TS.
- ❌ Don't store Google's `place_id` on `session_records` — always go through `restaurants.id`.
- ❌ Don't pre-install `@tanstack/react-query` — the stack decisions table explicitly excludes it from this plan.

---

## Phase 2 — Auth UI, server session, and user menu

**Model tier:** default (Sonnet). **Can run in parallel with Phase 5.**

### Context brief (cold-start)
Phase 1 has set up Supabase (migrations applied, RLS on, admin client scaffolded), the browser/server clients, the `proxy.ts` session refresher, and added `ResolvedPlace` + `finishedSessions` to the store. In this phase you will add email+password sign-up/sign-in (Google OAuth is out of scope for this plan), a server action for sign-out, and a user menu in the nav. The app must still work **anonymously** (guest mode) — Phases 3/6 build on this by promoting guest data on first login.

Files this phase may edit: `app/(auth)/**`, `app/auth/**`, `app/actions/auth.ts`, `components/nav*.tsx`, `lib/auth/**`, `app/layout.tsx` (only to mount the server-side user fetch). **Do not touch** `lib/types.ts`, `lib/store.ts`, `app/setup/page.tsx`, or anything under `app/api/places/` — those are owned by Phase 1 / Phase 5.

### Tasks
1. Create `app/(auth)/login/page.tsx` and `app/(auth)/signup/page.tsx` as **server** components that render a client form component `components/auth/auth-form.tsx` with a `mode` prop (`"login" | "signup"`).
2. `auth-form.tsx` is `"use client"`, uses `lib/supabase/client.ts` to call `signInWithPassword` / `signUp({ email, password, options: { emailRedirectTo: <origin>/auth/confirm } })`. Error messages rendered inline in the style of `app/setup/page.tsx`. On success: `router.push('/')` (or `/confirm-email` for signup if Supabase requires email confirmation in the project settings).
3. Create `app/auth/confirm/route.ts` — handles the email confirmation link (`verifyOtp({ type: 'email', ... })`). Redirect to `/` on success, `/login?error=confirm_failed` on failure.
4. Create `app/actions/auth.ts`:
   ```ts
   "use server";
   import { redirect } from "next/navigation";
   import { createClient } from "@/lib/supabase/server";
   export async function signOut() {
     const supabase = await createClient();
     await supabase.auth.signOut();
     redirect("/login");
   }
   ```
   (Note: `createClient()` in server.ts is async because it awaits `cookies()`.)
5. Refactor `components/nav.tsx`:
   - Keep the existing file as the **client** component. Rename it internally to `NavClient` (export `NavClient`).
   - Add two new props: `user: { email: string } | null` and `onSignOut: () => void` (the second is wired via a `<form action={signOut}>` wrapper in the server component — pass a React server action reference as a prop is fine in Next 16).
   - Render a user-menu element on the right: if `user`, show the first two letters of the email as an avatar + a dropdown with "Sign out"; if `null`, show a `Link` to `/login`.
   - Use a single convention for nav items: **hide** items the user can't access (drop the `disabled` styling). Update `ALWAYS_ENABLED` to `ALWAYS_VISIBLE` and add the inverse logic: items in `ALWAYS_VISIBLE` always show; others show only when `sessionActive` OR `user`. Add `/history` to the items shown only when `user`.
6. Create `components/nav-server.tsx` — a server component that:
   - Imports `createClient` from `lib/supabase/server`.
   - Fetches the user via `supabase.auth.getUser()`.
   - Renders `<NavClient user={user ? { email: user.email! } : null} signOutAction={signOut} />` (passing the server action as a prop is supported in Next 16 — cite the `server-actions.md` doc).
7. Update `app/layout.tsx` to render `<NavServer />` instead of `<Nav />`.
8. Create `lib/auth/require-user.ts`:
   ```ts
   import "server-only";
   import { redirect } from "next/navigation";
   import { createClient } from "@/lib/supabase/server";
   export async function requireUser() {
     const supabase = await createClient();
     const { data: { user } } = await supabase.auth.getUser();
     if (!user) redirect("/login");
     return { user, supabase };
   }
   ```

### Verification
- [ ] `npm run build` succeeds.
- [ ] `npm run lint` clean.
- [ ] You can sign up with email+password, land on `/`, refresh, and still be signed in (cookies persist through `proxy.ts`).
- [ ] Signing out returns you to `/login` and `getUser()` returns null.
- [ ] Nav shows the email initials when signed in, "Log in" link when signed out.
- [ ] Nav hides (not disables) items the user can't access. No element has the old disabled-muted styling.
- [ ] Anonymous guest can still visit `/setup` → `/library` → `/combos` → `/tracker` → `/result` — the existing Playwright spec still passes unchanged.
- [ ] Cite the exact `node_modules/next/dist/docs/` file paths you read for server actions, proxy session cookies, and `cookies()`.

### Anti-pattern guards
- ❌ Don't use client-side `useRouter().push('/login')` for the sign-out flow — use the server action + `redirect()`.
- ❌ Don't put the Supabase client in React Context. Instantiate per-request on the server, per-component on the client.
- ❌ Don't block guest mode. Phase 6 handles the guest→user migration; until then, guests must still get the full in-session UX.
- ❌ Don't add Google OAuth. It's deferred — see Out-of-scope.
- ❌ Don't ship a mixed disabled-vs-hidden nav. One pattern only.

---

## Phase 3 — Persist finished sessions & render history

**Model tier:** strongest. **Depends on:** Phases 1, 2, AND 5 (all three must be merged). Not parallelizable.

### Context brief (cold-start)
Phases 1, 2, and 5 are all merged. Phase 1 added `ResolvedPlace` to the `Session` type and `setResolvedPlace` to the store; Phase 2 shipped auth and `requireUser()`; Phase 5 added the restaurant combobox that writes a `ResolvedPlace` to the store. In this phase you persist a **finished** session from a signed-in user to `session_records`, render a history list, and render a per-session detail page. Guest finish behavior is unchanged.

**Trust boundary you must respect:** the only client-supplied field you are allowed to trust is `resolvedPlace.googlePlaceId`. The server re-fetches the canonical name/address/lat/lng via Places Details (reusing Phase 5's server-side helper) before upserting into `restaurants`. Never write `name`/`address`/`lat`/`lng` straight from the client payload — doing so lets any signed-in user pollute the shared restaurants table.

### Tasks
1. Extract the server-side Places Details fetch from `app/api/places/resolve/route.ts` into a reusable server-only helper `lib/places/resolve.ts`:
   ```ts
   import "server-only";
   export async function fetchPlaceDetails(placeId: string): Promise<{
     googlePlaceId: string;
     name: string;
     formattedAddress: string;
     lat: number;
     lng: number;
   }>;
   ```
   Both the Phase 5 route handler and the Phase 3 server action call this helper. The route handler becomes a thin wrapper.
2. Create `app/actions/sessions.ts` with a server action `finishAndSaveSession(input)`:
   ```ts
   "use server";
   import "server-only";
   // input: {
   //   clientSessionId: string,        // the draft Session.id
   //   googlePlaceId: string,          // only trusted client field
   //   buffetPrice: number,
   //   appetiteBudget: number,
   //   library: Item[],
   //   eaten: EatenEntry[],
   //   startedAt: string,
   // }
   // steps:
   //   1. requireUser()
   //   2. fetchPlaceDetails(googlePlaceId)  ← server-side, authoritative
   //   3. adminClient.from('restaurants').upsert(
   //        { google_place_id, name, formatted_address, lat, lng },
   //        { onConflict: 'google_place_id', ignoreDuplicates: false }
   //      ).select().single()
   //   4. compute totalEatenValue, margin, won via lib/calc.ts (with a SessionRecord-shaped adapter)
   //   5. authed client insert into session_records with:
   //        { user_id: auth.uid, restaurant_id, client_session_id,
   //          buffet_price, appetite_budget, library, eaten,
   //          total_eaten_value, margin, won, started_at, finished_at: new Date().toISOString() }
   //      with onConflict: 'user_id,client_session_id' → idempotent
   //   6. return { id: insertedRow.id }
   ```
   Use the authenticated server client (`createClient` from `server.ts`) for the `session_records` insert — RLS enforces `auth.uid() = user_id`. Use the admin client only for the `restaurants` upsert.
3. Update `lib/calc.ts` to export a thin adapter `computeTotals(library: Item[], eaten: EatenEntry[]): { total: number; margin: number; won: boolean }` that the existing `Session`-shaped functions also delegate to. This avoids duplication between the in-progress `Session` and the finished `SessionRecord` shapes.
4. Update `app/tracker/page.tsx`'s "Finish meal" button:
   - If signed in AND `session.resolvedPlace?.googlePlaceId` is set: call `finishAndSaveSession` → route to `/history/[id]` (the returned row id). On failure, show an inline error and remain on the tracker.
   - If signed in AND no `resolvedPlace`: show an inline error: "Pick a restaurant on the setup screen to save this meal" with a link back to `/setup`. Do NOT let them finish.
   - If guest: unchanged (local `finishMeal()` → `/result`).
5. Create `app/history/page.tsx` — server component:
   - `const { user, supabase } = await requireUser();`
   - `select id, finished_at, buffet_price, total_eaten_value, margin, won, restaurants(name, formatted_address) from session_records where user_id = user.id order by finished_at desc limit 20 offset <page>` — use the PostgREST join syntax.
   - Render rows with: restaurant name, date, buffet price, total eaten, margin (green/red), win/loss badge.
   - Pagination via query param `?page=0`.
   - Empty state: "No meals logged yet. Start a session to track your first W."
6. Create `app/history/[id]/page.tsx` — server component:
   - `params` is a `Promise` in Next 16 — `const { id } = await params`.
   - `requireUser()`, then select the single row by id joined with `restaurants`. Zero rows → `notFound()` (not redirect).
   - Render the breakdown table (match the styling of the existing `/result` page) plus the restaurant name + address header.
7. Nav visibility: confirm the Phase 2 nav change already shows `/history` for signed-in users. If not, add it.

### Verification
- [ ] Signing in, starting a session, picking a resolved restaurant via the Phase 5 combobox, finishing a meal → a row appears in `session_records` with the authoritative (server-fetched) name/address.
- [ ] **Tampering test:** call `finishAndSaveSession` with a valid `googlePlaceId` but a lie-payload `name: "<script>"` in the calling client — the persisted row's restaurant name is still the server-fetched canonical name. (Can test by temporarily overriding the client payload in devtools.)
- [ ] Calling `finishAndSaveSession` twice with the same `clientSessionId` inserts exactly one row (second call returns the same id or does nothing — upsert path).
- [ ] `/history` lists the row with the correct restaurant name.
- [ ] `/history/[id]` renders the detail view; trying another user's id via URL manipulation returns `notFound()` (RLS hides the row → zero results → 404).
- [ ] Signed-in user with no `resolvedPlace` is blocked from finishing with a clear inline error.
- [ ] `grep -rn 'from "@/lib/supabase/admin"' app/ components/` returns only hits under `app/actions/` (or other `"use server"` files). Client imports would fail at build time thanks to `import "server-only"`.
- [ ] Guest happy-path E2E still passes unchanged.
- [ ] `npm run build` clean.
- [ ] `npm run lint` clean.

### Anti-pattern guards
- ❌ Don't trust client-supplied `name`/`formattedAddress`/`lat`/`lng`. Re-fetch Places Details server-side.
- ❌ Don't query `session_records` from a client component. Server components + server actions only.
- ❌ Don't duplicate calc math in the server action — import `computeTotals` from `lib/calc.ts`.
- ❌ Don't upsert restaurants by name. Upsert by `google_place_id` only.
- ❌ Don't manually `JSON.stringify` the `library`/`eaten` arrays — `supabase-js` serializes `jsonb` columns automatically. Pass the JS array directly.
- ❌ Don't omit `client_session_id` from the insert — it's the Phase 6 idempotency key.
- ❌ Don't install React Query. Every page here is a server component.

---

## Phase 4 — Stats pages: per-location and total win/loss

**Model tier:** default. **Depends on:** Phase 3.

### Context brief (cold-start)
Phase 1 created `user_stats` and `restaurant_stats` views (with `security_invoker = on` and `grant select to authenticated`). Phase 3 is inserting into `session_records`. This phase adds two pages: `/stats` (lifetime totals) and a per-restaurant drill-down at `/history/by-restaurant/[restaurantId]`.

### Tasks
1. Create `lib/db/stats.ts` with server-only query helpers (first line: `import "server-only";`):
   - `getUserStats(supabase): Promise<UserStats | null>` — `select * from user_stats limit 1` (RLS already scopes to the caller; if the user has zero sessions, returns null).
   - `getRestaurantStats(supabase): Promise<RestaurantStats[]>` — ordered by `last_visited_at desc`.
   - `getSessionsAtRestaurant(supabase, restaurantId): Promise<SessionRecord[]>`.
   - `getRestaurantById(supabase, restaurantId): Promise<Restaurant | null>`.
2. Create `app/stats/page.tsx` — server component:
   - `requireUser()` → `getUserStats` + `getRestaurantStats`.
   - Headline: `Record: {wins}–{losses}`. If `total_sessions === 0`, show the empty-state message and a CTA link to `/setup`.
   - Lifetime margin: `+$214.50` (green) or `−$38.25` (red).
   - "Best run" and "Worst run" callouts. Show `best_margin` and `worst_margin` as-is, regardless of sign. **Do not** special-case all-losses with a "Closest call" label — the sign of the number speaks for itself.
   - Below: a table of all restaurants with columns [Name, Visits, W–L, Total Margin, Last Visited], default-sorted by `last_visited_at desc`.
3. Create `app/history/by-restaurant/[restaurantId]/page.tsx` — server component:
   - `const { restaurantId } = await params;` (Next 16 async params).
   - `requireUser()`.
   - `getRestaurantById(supabase, restaurantId)` — zero rows → `notFound()`. (This call will return zero rows both when the restaurant doesn't exist AND when the user has never been there — because the RLS-scoped `session_records` query in the next step would be empty anyway. To be safe, fetch the restaurant directly, then fetch the user's sessions at that restaurant; if *zero* sessions, `notFound()`.)
   - Header: restaurant name + address + W–L at this location (derive from the sessions list).
   - List of every session at this restaurant for this user, most recent first.
4. Nav: convert the `History` entry into a grouped control. Desktop: a single "History" link that lands on `/history`, plus a separate "Stats" top-level link. Mobile (≤640px): two top-level entries (History, Stats). Do not build a custom dropdown — two top-level links is cleaner and consistent with the existing nav pattern.
5. Empty-state copy: "You haven't logged a meal yet. Start a session to track your first W." — rendered on `/stats` when `total_sessions === 0`.

### Verification
- [ ] After logging two sessions at two different restaurants with mixed win/loss (via the Phase 3 flow), `/stats` reports the correct totals.
- [ ] `/history/by-restaurant/[id]` only shows sessions at that restaurant for the current user (manual check: sign in as User B, try a restaurant_id that User A has sessions at — must `notFound()` because User B has zero sessions there).
- [ ] Numbers match hand-computed totals for the test dataset.
- [ ] Empty state renders for a brand new user without crashing on the null `user_stats` row.
- [ ] Views are queryable from the authenticated role without permission errors (confirms the Phase 1 `grant select` worked).
- [ ] `npm run build` clean.

### Anti-pattern guards
- ❌ Don't compute stats in JS by fetching every session and summing client-side — always use the views.
- ❌ Don't trust a `restaurantId` from the URL without going through RLS-scoped queries.
- ❌ Don't query the jsonb `library`/`eaten` arrays — use the denormalized numeric columns.
- ❌ Don't add a "Closest call" label for all-losses. `best_margin` shown as-is is enough.

---

## Phase 5 — Google Places autocomplete on the setup screen

**Model tier:** strongest. **Depends on:** Phase 1 only. **Can run in parallel with Phase 2.**

### Context brief (cold-start)
Phase 1 added `ResolvedPlace` to the `Session` type and `setResolvedPlace` to the Zustand store. Currently `app/setup/page.tsx` has a plain text input for restaurant name. You're replacing it with a search-as-you-type combobox that queries Google Places API (New) Autocomplete via a Next.js Route Handler, then resolves the chosen suggestion to a canonical place via Place Details. The resolved object is stored via `setResolvedPlace`; Phase 3 later consumes it on finish.

Files this phase may edit: `app/api/places/**`, `components/restaurant-combobox.tsx`, `lib/places/**`, `app/setup/page.tsx`. **Do not touch** `lib/types.ts`, `lib/store.ts`, `components/nav*`, or anything under `app/(auth)/**` or `app/actions/auth.ts` — those are owned by Phase 1 / Phase 2.

### Tasks
1. Create `lib/places/resolve.ts` (server-only helper, first line `import "server-only";`):
   - `fetchPlaceDetails(placeId: string): Promise<ResolvedPlace>` — calls `https://places.googleapis.com/v1/places/{placeId}` with `X-Goog-Api-Key` and `X-Goog-FieldMask: id,displayName,formattedAddress,location`. Maps response → `ResolvedPlace`.
   - `fetchAutocomplete(input, sessionToken, bias?): Promise<Array<{ placeId; primaryText; secondaryText }>>` — calls `https://places.googleapis.com/v1/places:autocomplete` with the same key header, `X-Goog-FieldMask: suggestions.placePrediction.placeId,suggestions.placePrediction.text`, body `{ input, sessionToken, locationBias?, includedPrimaryTypes: ["restaurant", "meal_takeaway", "food"] }`.
   - Both functions throw `PlacesApiError` with a normalized shape on non-2xx — never leak Google's raw error body.
2. Create `app/api/places/autocomplete/route.ts` (thin wrapper around `fetchAutocomplete`):
   - `POST` body: `{ input: string, sessionToken: string, bias?: { lat: number; lng: number; radius: number } }`.
   - **Reject `input.length < 3`** with 400 `{ error: "input_too_short" }`. Debounce alone is not enough to cap billing.
   - Returns a thin DTO array. Never the raw Google response.
3. Create `app/api/places/resolve/route.ts` (thin wrapper around `fetchPlaceDetails`):
   - `POST` body: `{ placeId: string }`.
   - Returns `ResolvedPlace`.
4. Add a **best-effort** in-memory rate limit on both routes: `Map<ip, { count, windowStart }>`, 60 req/min. Treat this as dev-only — add a comment at the top: `// DEV-ONLY rate limit. Per-instance in-memory Map leaks on serverless cold starts. Before public launch, move to Upstash/Vercel KV.` Do not add `@upstash/ratelimit` — keeping deps minimal until we actually need durable rate limiting.
5. Create `components/restaurant-combobox.tsx` (`"use client"`):
   - Import from the namespaced subpath, using the composed parts recorded in Phase 0 notes:
     ```ts
     import { Combobox } from "@base-ui/react/combobox";
     // Use: <Combobox.Root>, <Combobox.Input>, <Combobox.Positioner>,
     //      <Combobox.Popup>, <Combobox.List>, <Combobox.Item>
     ```
     **Copy the exact skeleton from `plans/.phase0-notes.md`** — do not guess the API.
   - Controlled: `const [query, setQuery] = useState(""); const [items, setItems] = useState<Suggestion[]>([]);`
   - **Debounce at 300ms** AND **gate on `query.trim().length >= 3`** before firing autocomplete. Both are required for billing sanity.
   - **Session token lifecycle**: generate a fresh UUIDv4 session token when the combobox opens OR after a successful resolve. Reuse the same token across all autocomplete calls until a resolve happens; then rotate.
   - **Per-token cap**: track autocomplete request count per session token, max 10. After 10, stop firing until the user selects or the token rotates.
   - **Geolocation**: ask once via `navigator.geolocation.getCurrentPosition` with clear copy ("Use your location to find nearby restaurants?"). Cache the result in component state. On deny or error, proceed without `locationBias`.
   - Render each suggestion with primaryText (bold) + secondaryText (muted).
   - On select: POST `/api/places/resolve` with the `placeId`, call `setResolvedPlace(result)`, render a read-only confirmation row "Selected: {name} — {address}" with a "Change" button that clears `resolvedPlace` and reopens the combobox.
   - Include a "None of these — enter manually" trailing item that clears `resolvedPlace` and falls back to a plain `<Input>` for the name (this path is allowed for guests; signed-in users will be blocked at finish time by Phase 3).
6. Replace the restaurant name `Input` in `app/setup/page.tsx` with `<RestaurantCombobox />`. The form's `restaurantName` state becomes derived: `resolvedPlace?.name ?? manualName`. On submit, call `startSession({ ..., resolvedPlace })` (the store action accepts it per Phase 1).
7. Guest fallback: signed-out users who pick "enter manually" proceed with a free-text name (current behavior — Phase 1 did not remove the legacy field). Signed-in users who pick "enter manually" are NOT blocked here — they're blocked at Finish time in Phase 3 with a clear error. This keeps Phase 5 independent of Phase 2.

### Verification
- [ ] Typing "kb" (2 chars) does NOT fire the autocomplete request (400 `input_too_short` is never reached because the client gates first).
- [ ] Typing "kbbq" in San Francisco returns real nearby restaurants.
- [ ] Selecting a suggestion populates the Zustand store's `resolvedPlace` with a valid object.
- [ ] The Google API key is not in the client bundle: `grep -r "GOOGLE_PLACES_API_KEY" .next/static` returns nothing.
- [ ] Session token rotates after a successful resolve (inspect network tab: second autocomplete session uses a new token).
- [ ] Per-token cap: firing 11 autocomplete calls without a resolve stops at 10 client-side (no 11th request).
- [ ] Rate limit returns 429 after 60 requests in a minute from the same IP during dev.
- [ ] Guest mode still allows proceeding via "None of these — enter manually".
- [ ] Cite the Places docs file/URL and the `.phase0-notes.md` Combobox skeleton in the step's exit notes.

### Anti-pattern guards
- ❌ Don't hit Google Places directly from a `"use client"` file. Always via the Route Handler.
- ❌ Don't fire autocomplete on fewer than 3 characters. Billing footgun.
- ❌ Don't reuse a session token across unrelated searches — breaks Google's billing model.
- ❌ Don't prefetch Place Details on every keystroke — Details is the expensive call; fetch only on select.
- ❌ Don't cache Places results in `localStorage`/`IndexedDB` — Google's ToS forbids storing the response beyond 30 days. Cache only `place_id` and your own `restaurants` row (written by the server in Phase 3).
- ❌ Don't guess the `@base-ui/react` API. Use the Phase 0 skeleton.
- ❌ Don't add `@upstash/ratelimit`. In-memory dev limit is fine until we actually ship publicly.

---

## Phase 6 — Guest → user data migration on first sign-in

**Model tier:** default. **Depends on:** Phases 2, 3, 5.

### Context brief (cold-start)
A user may build up sessions in guest mode (Zustand + localStorage) and then create an account. Phase 1 added an empty `finishedSessions: Session[]` array to the store; this phase populates it on guest finish and drains it into `session_records` on first login. The Phase 1 unique index on `(user_id, client_session_id)` makes the migration **idempotent at the database layer** — retries, network drops, and double-tab races cannot double-insert.

### Tasks
1. Update `lib/store.ts`:
   - In `finishMeal()`: if the session has `resolvedPlace` set, push a deep copy of the full session (including its `id`, which is the idempotency key) into `finishedSessions`. If no `resolvedPlace`, still push it (Phase 3's signed-in path blocks this case at finish time; for guests, the session lives in localStorage and we may let them resolve it later via the skipped-list UI below).
   - Add an action `removeFinishedSession(id: string)` that Phase 6's code calls after a confirmed successful insert.
   - **Do not** add a blanket `clearFinishedSessions()` — removing by id forces per-session confirmation and avoids losing data if a partial batch fails.
2. Create `app/actions/migrate.ts` with server action `promoteGuestSessions(sessions: Session[])`:
   ```ts
   "use server";
   import "server-only";
   // For each guest session:
   //   - if !session.resolvedPlace: skip with reason "no_place"
   //   - else: call the SAME helper that finishAndSaveSession uses in Phase 3:
   //       fetchPlaceDetails → upsert restaurant → insert session_records
   //       using client_session_id = session.id and
   //       supabase.from('session_records').upsert(..., {
   //         onConflict: 'user_id,client_session_id',
   //         ignoreDuplicates: true,
   //       })
   //   - on success for that session: return its id in the `promoted` array
   //   - on per-session failure: return it in `failed` with the error message
   // Returns: { promoted: string[], skipped: {id, reason}[], failed: {id, error}[] }
   ```
   Because the insert uses `onConflict` + `ignoreDuplicates: true`, a second call with the same sessions is a no-op at the DB layer — this is the primary idempotency guarantee. The store's `removeFinishedSession` calls are a secondary optimization (so we don't keep retrying already-promoted sessions), not a correctness mechanism.
3. Create `components/guest-migration-effect.tsx` (`"use client"`) — mounted once in `app/layout.tsx` under `<NavServer />`:
   - Reads `user` from a new client hook `useCurrentUser()` that subscribes to `supabase.auth.onAuthStateChange`.
   - Reads `finishedSessions` from the Zustand store.
   - When `user` transitions from `null → {...}` AND `finishedSessions.length > 0`: call `promoteGuestSessions(finishedSessions)`.
   - On response: for each id in `result.promoted`, call `removeFinishedSession(id)`. Leave `skipped` and `failed` in the store — the next mount will surface them.
   - Show a toast: `Imported N meals. M still need a restaurant picked.`
   - **Do not** gate this on a "has run" flag. The gate is DB-side idempotency. Mount side effects are safe to re-run because the server upserts with `ignoreDuplicates`.
4. Create `app/import/page.tsx` — server component + small client helper:
   - `requireUser()`.
   - Reads `finishedSessions` from the client store (client child component) and filters to those with no `resolvedPlace` or marked as `failed`.
   - For each row: show the session summary + a `<RestaurantCombobox />` (from Phase 5) and a "Save" button that patches the session in the store with the new `resolvedPlace` and re-triggers `promoteGuestSessions([patchedSession])`.
   - Success → `removeFinishedSession(id)` → row disappears.
   - Empty list → "Nothing to import." + link back to `/`.
5. Link to `/import` in the nav (signed-in only) **only** when `finishedSessions.length > 0`. Hide it otherwise — no dead links.

### Verification
- [ ] Guest logs 3 sessions (2 with resolved places, 1 without), then signs up → 2 rows appear in `session_records`, 1 appears in `/import`.
- [ ] **Idempotency (primary):** run `promoteGuestSessions` twice with the same payload → `session_records` count is unchanged on the second call.
- [ ] **Double-tab race:** open two tabs, both signed in with the same `finishedSessions` in localStorage (copy between tabs before either finishes the migration). Both tabs fire `promoteGuestSessions` concurrently → still exactly one row per `client_session_id`.
- [ ] Network drop during migration (simulate with devtools offline mid-call): `finishedSessions` still contains the un-promoted ids. Going back online and reloading the page re-runs the effect and successfully inserts them.
- [ ] Signing out then signing in as a *different* user does not insert the first user's sessions under the second user's id (the effect only fires on `null → user` transitions and the server action enforces `auth.uid() = user_id` via RLS).
- [ ] `npm run build` + `npm run lint` clean.

### Anti-pattern guards
- ❌ Don't rely on a client "has run" flag as the idempotency mechanism. DB unique index is the source of truth.
- ❌ Don't clear `finishedSessions` wholesale after the promote call. Remove by id, only after per-session confirmation.
- ❌ Don't run the migration inside a render — use an effect gated on the auth-state transition.
- ❌ Don't migrate sessions without `finishedAt`. In-progress drafts stay device-local.
- ❌ Don't bypass the Phase 3 server-side placeId re-fetch. Reuse the same helper — the trust boundary is identical.

---

## Phase 7 — Verification, tests, and polish

**Model tier:** default. **Depends on:** everything.

### Tasks
1. Unit tests:
   - `lib/calc.test.ts` — add a case covering `SessionRecord`-shaped inputs through `computeTotals`.
   - New `lib/db/stats.test.ts` with a mocked Supabase client — verify the query helpers return the expected shape.
   - Verify that `lib/supabase/admin.ts`, `lib/supabase/server.ts`, `lib/supabase/proxy-session.ts`, `lib/db/stats.ts`, `lib/places/resolve.ts`, and `lib/auth/require-user.ts` all start with `import "server-only";` via a simple grep test:
     ```ts
     // lib/server-only.test.ts
     import fs from "node:fs";
     const files = [
       "lib/supabase/admin.ts",
       "lib/supabase/server.ts",
       "lib/supabase/proxy-session.ts",
       "lib/db/stats.ts",
       "lib/places/resolve.ts",
       "lib/auth/require-user.ts",
     ];
     it.each(files)("%s is marked server-only", (f) => {
       expect(fs.readFileSync(f, "utf8")).toMatch(/^import\s+"server-only";/);
     });
     ```
     The `server-only` package throws at build time if a client component transitively imports any of these, so this test is belt-and-suspenders.
2. E2E tests (`e2e/`):
   - Rename the current `happy-path.spec.ts` to `guest-path.spec.ts` (content unchanged — guest end-to-end flow).
   - Add `signed-in-path.spec.ts`:
     1. Global setup: seed a dedicated test user via the Supabase admin client + a fresh auth session.
     2. Sign in, start a session, open the restaurant combobox, pick a real nearby place, add 3 items, finish the meal.
     3. Assert `/history` lists the new row with the canonical restaurant name.
     4. Assert `/stats` shows `Record: 1–0` (or 0–1) and the lifetime margin matches.
   - Global teardown: delete the test user and cascade-clean the rows.
3. Lint gate (replaces the old `grep -rn " any"` gate):
   - `npm run lint` must be clean.
   - ESLint config has `@typescript-eslint/no-explicit-any: "error"` (set in Phase 1). Verify by temporarily introducing `const x: any = 1;` and confirming lint fails.
4. Secret-leak gate:
   - `npm run build` first.
   - Then: `grep -r "SUPABASE_SERVICE_ROLE_KEY\|GOOGLE_PLACES_API_KEY" .next/static/ || true` — must return zero matches (the `|| true` prevents the grep exit from failing the step if there are zero matches, which is the desired outcome).
5. TODO/FIXME gate (warning, not error):
   - `grep -rn "TODO\|FIXME" lib/ app/ components/ --include="*.ts" --include="*.tsx"` — list any hits and decide per-line whether to address or explicitly accept.
6. Build + test gates:
   - `npm run build` — clean, no warnings.
   - `npm test` — all green.
   - `npx playwright test` — both specs green.
7. Mobile review: every new page usable at 375px wide (login, signup, history, history detail, stats, combobox dropdown, import).
8. Manual smoke: clear localStorage + sign out; sign up fresh; go through setup (pick a real restaurant) → library → combos → tracker → finish → history → stats. Confirm win/loss numbers and restaurant name match.
9. Guest smoke: clear cookies + localStorage; walk through the original guest flow; confirm nothing regressed.
10. Run `mcp__claude_ai_Supabase__get_advisors` one more time (security + performance). Zero `ERROR` findings.
11. Update `README.md` with: required env vars, Supabase setup steps (CLI + project), Google Places API key provisioning + billing cap note, and how to run the two E2E specs.

### Final acceptance
- [ ] Signed-in end-to-end journey (sign up → session with Places pick → finish → history → stats) passes E2E.
- [ ] Guest end-to-end journey (the original happy path, renamed) still passes.
- [ ] `npm run lint` clean with `no-explicit-any: error`.
- [ ] Secret-leak grep over `.next/static/` returns zero matches.
- [ ] `npm run build`, `npm test`, `npx playwright test` all green.
- [ ] Advisors report zero `ERROR` findings.
- [ ] README.md updated.
- [ ] `server-only` enforcement test passes for all six server-only modules.

### Anti-pattern guards
- ❌ Don't skip mobile review.
- ❌ Don't suppress TS or lint errors.
- ❌ Don't mock the DB for the signed-in E2E — hit a real Supabase preview project.
- ❌ Don't rely only on the grep gate for secrets — `server-only` is the primary enforcement; the grep is a backstop.

---

## Out-of-scope for this plan (explicitly deferred)

- **Google OAuth sign-in** (email+password only in this plan — OAuth needs a human to click through the Supabase dashboard and is a separate plan).
- **Active draft session sync across devices** — only *finished* sessions sync. Starting a meal on your phone and finishing on your laptop is not supported.
- **Magic link auth.**
- **Social sharing** of W/L records.
- **Leaderboards** or any multi-user feature beyond each user seeing their own data.
- **Mapbox / OpenStreetMap fallback** for Places.
- **Photo upload** per session.
- **Importing Google Maps timeline history.**
- **Currencies other than USD.**
- **Restaurant ownership / claim flows** ("is this your restaurant?").
- **Tagging, favorites, or notes** on restaurants beyond what the schema already has.
- **Durable rate limiting** on the Places routes (the in-memory dev limit is a placeholder; before public launch, move to Upstash/Vercel KV).

---

## Appendix A — Google Places API (New) billing notes

**Read before starting Phase 5.** Places billing has a non-obvious sharp edge that the reviewer flagged:

- **Autocomplete (with Session, bundled):** If the user types, picks a suggestion, and the client calls Place Details using the **same session token**, all the autocomplete requests + the details call are billed as **one** "Autocomplete Session" SKU. This is cheap.
- **Autocomplete (abandoned, NOT bundled):** If the user types and walks away without selecting — no Place Details call with that token — every autocomplete request is billed **individually** under the "Autocomplete (without Place Details)" SKU. This is the common case and the billing footgun. Debounce + min-3-chars gate + per-token request cap (all enforced in Phase 5 Task 5) are the mitigation.
- **Place Details SKU tier:** depends on the field mask. `id,displayName,formattedAddress,location` is in the **Essentials** tier. Phase 0 must record the current $/1000 rate for this tier before Phase 5 starts — it has changed before.
- **Free credit:** Google provides a rolling monthly credit (historically ~$200) that usually covers dev and low-volume production. Don't rely on it — set a quota cap.

### Human-only steps (no MCP equivalent)
1. Create a Google Cloud project and enable the Places API (New).
2. Create an API key, restrict it to the Places API (New) **and** to server IPs only (since the key never ships to the client, don't add HTTP referrer restrictions).
3. **Set a billing quota cap** — recommended $25/day for dev — before putting the key in `.env.local`.
4. Paste the key into `.env.local` as `GOOGLE_PLACES_API_KEY=...`.

## Appendix B — Anti-pattern watchlist (from adversarial review)

Failure modes a reviewer should look for in every PR of this plan:

1. **`middleware.ts` file at repo root.** Next 16 ignores it. Must be `proxy.ts`.
2. **Synchronous `cookies()` / `headers()` / `params`.** All async in Next 16 — must be `await`ed.
3. **Client component importing a server-only file.** Primary defense: `import "server-only"` at the top of each server module. Secondary defense: the `lib/server-only.test.ts` guard.
4. **Service-role client used outside the `restaurants` upsert path.** `admin.ts` is only for server actions that need to bypass RLS for the shared `restaurants` table. All `session_records` writes go through the authenticated server client.
5. **Trusting client-supplied place name / address / lat / lng.** Only `googlePlaceId` is trusted; everything else is re-fetched server-side via `fetchPlaceDetails`.
6. **Guest → user migration without `(user_id, client_session_id)` upsert.** Must use `onConflict: 'user_id,client_session_id'` + `ignoreDuplicates: true`. Client-side "has run" flag is not enough.
7. **Anon `SELECT` on `public.restaurants`.** Policies must be `to authenticated`, not `using (true)`.
8. **Missing `grant select` on views.** `security_invoker` views don't inherit grants; `user_stats` and `restaurant_stats` need explicit grants to `authenticated`.
9. **Session records persisted from `useEffect` on a client page** instead of a server action.
10. **Reusing Google session tokens across unrelated searches.**
11. **Autocomplete fired on < 3 characters** or without a per-token request cap — billing footgun.
12. **Caching Place Details response in `localStorage`/`IndexedDB`.** ToS violation.
13. **Computing stats in JS** by fetching every session and summing — use the views.
14. **Duplicating calc math** outside `lib/calc.ts`. `computeTotals` is the single source of truth.
15. **Breaking guest mode** in pursuit of "logged-in only" semantics.
16. **Storing `place_id` directly on `session_records`** instead of going through `restaurants.id`.
17. **Writing `any`** "just for this one spot" — blocked by ESLint.
18. **Disabled-vs-hidden nav items mixed.** Pick one (hidden) and stick to it.
19. **Pre-installing `@tanstack/react-query`** — this plan's history/stats pages are all server components, RQ is not needed and should not be added.

---

## Appendix C — Change log (plan mutation protocol)

Changes to this plan after initial draft:

| Date | Phase | Change | Reason |
|---|---|---|---|
| 2026-04-08 | — | Initial draft | Blueprint generation |
| 2026-04-08 | 0, 1, 2 | `middleware.ts` → `proxy.ts`, `cookies()` must be awaited | Next 16 rename + async dynamic APIs. Pasting stale Supabase snippets verbatim would silently break auth. |
| 2026-04-08 | 1 | `restaurants` RLS → `to authenticated` (not `using(true)`); views get explicit `grant select to authenticated`; `client_session_id` + unique index added | Close anon-read leak; make views actually queryable; give Phase 6 a DB-level idempotency key. |
| 2026-04-08 | 1, 3 | `ResolvedPlace` field added to `Session` in Phase 1 (not Phase 3) | Lets Phase 2 and Phase 5 actually run in parallel without colliding on `lib/types.ts`/`lib/store.ts`. |
| 2026-04-08 | 3 | Server action re-fetches Places Details from `placeId`; rejects client-supplied name/address/lat/lng | Close the pollution hole in the shared `restaurants` table. |
| 2026-04-08 | 5 | Added `input.length >= 3` gate, per-token request cap, exact Base UI combobox namespaced import, rate-limit caveat comment | Billing sanity + API correctness. |
| 2026-04-08 | 6 | DB-side idempotency via `upsert(onConflict, ignoreDuplicates)` replaces client "has run" flag; remove-by-id instead of wholesale clear | Survive network drops and double-tab races without double-inserting or losing data. |
| 2026-04-08 | 7 | ESLint `no-explicit-any: error` replaces the grep-for-`any` gate; `server-only.test.ts` added as a belt-and-suspenders check; secret grep runs against `.next/static/` post-build | Stricter type gate + earlier detection of client-bundle leaks. |
| 2026-04-08 | — | Google OAuth and active-draft cross-device sync moved to Out-of-scope | Keep the plan executable without human-clicks-Supabase-dashboard steps; active-draft sync is a separate design. |
| 2026-04-09 | 6 | Phase 6 implemented: `finishMeal()` populates `finishedSessions`, `promoteGuestSessions` reuses Phase 3 helpers with `ignoreDuplicates: true`, `GuestMigrationEffect` fires on auth-state transition, `/import` page for place-less sessions | Guest→user migration with DB-first idempotency, no client "has run" flag. |
| 2026-04-09 | 5 | Phase 5 executed: `lib/places/resolve.ts` + `/api/places/{autocomplete,resolve}` routes + `RestaurantCombobox` (controlled props, not store) wired into `app/setup/page.tsx`. Build + lint clean; `GOOGLE_PLACES_API_KEY` not in `.next/static`. | Combobox is controlled via props because the setup page has no active session yet, so `useAyceStore.setResolvedPlace` (which gates on `state.session`) would no-op there. Parent passes the resolved place into `startSession({ resolvedPlace })`. |
| 2026-04-09 | 3 | Phase 3 executed: `finishAndSaveSession` server action (admin-upsert restaurants by `google_place_id`, authed-upsert session_records with `onConflict: user_id,client_session_id`), `computeTotals` adapter in `lib/calc.ts`, signed-in branch in `app/tracker/page.tsx` Finish button, `app/history/page.tsx` list, `app/history/[id]/page.tsx` detail. Build + lint clean, 72/72 unit tests green, guest E2E unchanged, admin client imported only from `app/actions/sessions.ts`. | Trust boundary enforced by inspection: `FinishAndSaveInput` exposes `googlePlaceId` only; the restaurant upsert row is built entirely from `fetchPlaceDetails()` output, so client-supplied name/address/lat/lng cannot reach the shared `restaurants` table. |
| 2026-04-09 | 2 | **Shipped Phase 2 as planned.** Added `app/(auth)/{login,signup}/page.tsx`, `components/auth/auth-form.tsx`, `app/auth/confirm/route.ts`, `app/actions/auth.ts`, `lib/auth/require-user.ts`, refactored `components/nav.tsx` to `NavClient` + new `components/nav-server.tsx`, and mounted `<NavServer />` in `app/layout.tsx`. Deviations: (a) sign-out prop named `signOutAction` (not `onSignOut`) to match Next 16's server-action-as-prop convention documented in `mutating-data.md` ("Passing actions as props"). (b) Dropped the planned pathname-change `useEffect` that closed the user menu — React 19's new `set-state-in-effect` lint rule forbids it and the existing outside-click handler already covers the case. (c) No Google OAuth (explicitly out-of-scope). |
| 2026-04-09 | 4 | Phase 4 executed: `lib/db/stats.ts` (server-only query helpers using `user_stats` and `restaurant_stats` views), `app/stats/page.tsx` (lifetime record, margin, best/worst run, per-restaurant table), `app/history/by-restaurant/[restaurantId]/page.tsx` (drill-down with W-L header), Stats added to nav. Build + lint clean. Seeded 2 test sessions (Gen Korean BBQ WIN +$7.51, Todai Sushi Buffet LOSS −$10.99) — views returned correct aggregates: 1-1 record, −$3.48 total margin, best +$7.51, worst −$10.99. Empty state handles null `user_stats` row without crashing. No deviations from plan. | All stats computed via SQL views, not JS. `best_margin`/`worst_margin` shown as-is regardless of sign per plan requirement. |
| 2026-04-09 | 7 | Phase 7 executed: `lib/server-only.test.ts` (6 files), `lib/db/stats.test.ts` (mocked Supabase), `computeTotals` SessionRecord case in `calc.test.ts`, `e2e/happy-path.spec.ts` → `guest-path.spec.ts` rename, `e2e/signed-in-path.spec.ts` added, lint warning fixed in `app/library/page.tsx`, README.md rewritten, secret-leak grep clean, 84/84 unit tests green. | All verification gates green: `no-explicit-any: error` confirmed, zero secrets in `.next/static/`, zero TODO/FIXME, build clean. |
