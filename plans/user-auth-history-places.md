# ayceMon — User Auth, History, Stats & Restaurant Places Autocomplete

> **Objective:** Introduce user accounts so the site remembers each player across devices; persist every finished session per user; aggregate win/loss records per restaurant and overall; and replace the free-text restaurant name with a Google-Maps-style autocomplete that resolves to a canonical place (so stats can aggregate reliably).

**Generated:** 2026-04-08 · **Mode:** direct (no git repo initialized)
**Base branch / working dir:** `/Users/dyl/ayceMon` (edit in place)

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
1. Create a Supabase project via the Supabase MCP tool (`mcp__supabase__create_project`) with name `aycemon-dev`. Record the project ref in `.env.local` (do not commit). Assert the project's Postgres version is ≥ 15 — if not, fail the step and escalate.
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
5. Apply the migration via `mcp__supabase__apply_migration`.
6. Generate TS types: `mcp__supabase__generate_typescript_types` → write to `lib/supabase/database.types.ts`.
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
13. Run `mcp__supabase__get_advisors` with type `security` and type `performance`. Fix any `ERROR`-level findings before finishing the step.
14. Manual verification query (via `mcp__supabase__execute_sql` using the anon key context if possible; otherwise just inspect the policies):
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

**Model tier:** default. **Depends on:** Phases 1, 2, **and** the `/api/places/resolve` endpoint from Phase 5 (see note below).

### Context brief (cold-start)
Phase 2 shipped auth. The in-progress session is still in Zustand. When a signed-in user clicks "Finish meal" on `/tracker`, we now need to (a) resolve the restaurant to a `restaurants.id` (Phase 5 handles the autocomplete; this step just *consumes* the already-resolved `googlePlaceId` stored on the session buffer), (b) insert a `session_records` row, (c) show the result screen, and (d) make a new `/history` page that lists past sessions.

### Cross-phase contract (read this carefully)
After Phase 5 ships, `session: Session` in Zustand will carry a new optional field `resolvedPlace?: { googlePlaceId: string; name: string; formattedAddress: string; lat: number; lng: number }`. Phase 3 must:
1. Require `resolvedPlace` to be non-null when a signed-in user clicks "Finish meal" (render an inline error if missing — "Pick a restaurant to save this meal").
2. Allow guests to still finish without `resolvedPlace` (they just don't persist to DB — Phase 6 handles promotion).

### Tasks
1. Update the `Session` type in `lib/types.ts` to add:
   ```ts
   resolvedPlace?: {
     googlePlaceId: string;
     name: string;
     formattedAddress: string;
     lat: number;
     lng: number;
   };
   ```
   Update `lib/store.ts`:
   - `startSession` now also accepts `resolvedPlace?` and stores it.
   - New action `setResolvedPlace(place)` for mid-session edits.
2. Create `app/actions/sessions.ts` with a server action `finishAndSaveSession(input)` that:
   - Calls `require-user` (auth gate).
   - Upserts the restaurant by `google_place_id` (insert if new, return the row). **Use the service role key via the server-only admin client (`lib/supabase/admin.ts`) because RLS blocks inserts to `restaurants` from authenticated users.**
   - Inserts a `session_records` row with the snapshotted library/eaten arrays and computed totals (re-use `totalEatenValue`, `margin`, `didYouWin` from `lib/calc.ts`).
   - Returns the new record's id.
3. Create `lib/supabase/admin.ts` — server-only Supabase client built with `SUPABASE_SERVICE_ROLE_KEY`. Add a top-of-file comment: `// SERVER ONLY — do not import from any "use client" file`. Add a grep-based verification in the step's exit criteria.
4. Update `app/tracker/page.tsx`'s "Finish meal" button:
   - If signed in: call `finishAndSaveSession` → route to `/history/[id]`.
   - If guest: keep the existing behavior (local `finishMeal()` → route to `/result`).
5. Create `app/history/page.tsx` — server component:
   - Uses `require-user` + server Supabase client to `select` the user's `session_records` joined with `restaurants` (name, address).
   - Renders a paginated list (20 per page) with: restaurant name, date, buffet price, total eaten, margin, win/loss badge.
   - Each row links to `app/history/[id]/page.tsx`.
6. Create `app/history/[id]/page.tsx` — server component showing the same detailed breakdown `/result` shows today, plus the restaurant name/address. Must 404 (not redirect) if the row isn't found or belongs to another user (RLS will hide it — treat "zero rows" as 404).
7. Update nav: `History` becomes visible for signed-in users.
8. React Query: install `QueryClientProvider` in `app/layout.tsx` — **only if** Phase 4 actually needs it on the client. For Phase 3, server components are sufficient. Defer RQ install to Phase 4 if it adds no value here.

### Verification
- [ ] Signing in, starting a session, picking a resolved restaurant (use the Phase 5 UI), finishing a meal → row appears in `session_records`.
- [ ] `/history` lists that row with the correct restaurant name.
- [ ] `/history/[id]` renders the detail view; trying another user's id 404s.
- [ ] `grep -rn "supabase/admin" app/ components/` returns only hits from files with `"use server"` directives or under `app/api/`.
- [ ] Guest flow (Phase 2 E2E happy path) still passes unchanged.
- [ ] `npm run build` clean.

### Anti-pattern guards
- ❌ Don't query `session_records` from a client component. Server components + server actions only (RLS still applies, but the round-trip pattern is cleaner).
- ❌ Don't duplicate `totalEatenValue` math in the server action — import from `lib/calc.ts`.
- ❌ Don't upsert by name. Upsert by `google_place_id` only.
- ❌ Don't store `eaten`/`library` as TEXT or stringify before `insert` — it's `jsonb`; pass the array directly.

---

## Phase 4 — Stats pages: per-location and total win/loss

**Model tier:** default. **Depends on:** Phase 3.

### Context brief (cold-start)
Phase 1 created `user_stats` and `restaurant_stats` views. Phase 3 populated `session_records`. This phase adds two pages: `/stats` (total) and the per-restaurant drill-down on `/history/by-restaurant/[restaurantId]`.

### Tasks
1. Create `lib/db/stats.ts` with server-side query helpers:
   - `getUserStats(userId): Promise<UserStats>` — `select * from user_stats where user_id = $1`.
   - `getRestaurantStats(userId): Promise<RestaurantStats[]>` — ordered by `last_visited_at desc`.
   - `getSessionsAtRestaurant(userId, restaurantId): Promise<SessionRecord[]>`.
2. Create `app/stats/page.tsx` — server component:
   - Big headline: "Record: W–L (e.g. 7–4)".
   - Lifetime margin: "+$214.50" (green) or "−$38.25" (red).
   - Best session and worst session callouts.
   - Below: a table of all restaurants with columns [Name, Visits, W–L, Total Margin, Last Visited], sortable by last visited by default.
3. Create `app/history/by-restaurant/[restaurantId]/page.tsx` — server component:
   - Header: restaurant name + address + W–L at this location.
   - List of every session at this restaurant for this user.
4. Link the nav "History" item to a dropdown or a sub-nav with [All, By restaurant, Stats]. Mobile: three separate entries under a hamburger, matching existing nav patterns.
5. Empty-state for brand new users: "You haven't logged a meal yet. Start a session to track your first W."

### Verification
- [ ] After logging two sessions at two different restaurants with mixed win/loss, `/stats` reports the correct totals.
- [ ] `/history/by-restaurant/[id]` only shows sessions at that restaurant for the current user (manual check: sign in as User B, try User A's restaurant id — must 404/empty).
- [ ] Numbers match hand-computed totals for the test dataset.
- [ ] `npm run build` clean.

### Anti-pattern guards
- ❌ Don't compute stats in JS by fetching every session and summing client-side — always use the views.
- ❌ Don't trust a `restaurantId` from the URL without going through RLS-scoped queries.
- ❌ Don't show "Best margin" as negative — if all sessions are losses, show the "least bad loss" and label it "Closest call".

---

## Phase 5 — Google Places autocomplete on the setup screen

**Model tier:** strongest for the API integration; default for the UI. **Depends on:** Phase 1 (env var scaffolding) only — can run in parallel with Phase 2–4.

### Context brief (cold-start)
Currently `app/setup/page.tsx` has a plain text input for restaurant name. You're replacing it with a search-as-you-type combobox that queries the Google Places API (New) Autocomplete endpoint via a Next.js Route Handler, then resolves the chosen suggestion to a canonical place (name, address, lat/lng, `place_id`) via Place Details. The resolved object is stored in the Zustand session buffer; if the user is signed in, Phase 3's "Finish meal" action uses it to populate `session_records.restaurant_id`.

### Tasks
1. Create `app/api/places/autocomplete/route.ts` (Route Handler):
   - `POST` body: `{ input: string, sessionToken: string, bias?: { lat: number; lng: number; radius: number } }`.
   - Calls `https://places.googleapis.com/v1/places:autocomplete` with header `X-Goog-Api-Key: process.env.GOOGLE_PLACES_API_KEY` and `X-Goog-FieldMask: suggestions.placePrediction.placeId,suggestions.placePrediction.text`.
   - Filters to restaurant-like results only: pass `includedPrimaryTypes: ["restaurant", "meal_takeaway", "food"]` in the request body.
   - Returns a thin DTO: `Array<{ placeId: string; primaryText: string; secondaryText: string }>`.
   - **Never** returns the raw Google response to the client.
2. Create `app/api/places/resolve/route.ts` (Route Handler):
   - `POST` body: `{ placeId: string, sessionToken: string }`.
   - Calls `https://places.googleapis.com/v1/places/{placeId}` with `X-Goog-FieldMask: id,displayName,formattedAddress,location`.
   - Returns `{ googlePlaceId, name, formattedAddress, lat, lng }`.
3. Add a rate-limit-by-IP guard on both routes (simple LRU in-memory, 60 req/min per IP). Use `@upstash/ratelimit` only if Phase 0 notes say it's acceptable; otherwise a hand-rolled `Map<string, { count, windowStart }>` is fine for dev.
4. Create `components/restaurant-combobox.tsx` — client component:
   - Uses `@base-ui/react` Combobox (already a dep) — check `node_modules/@base-ui/react` for the actual exported name if Combobox isn't the right import.
   - Debounces input at 300ms.
   - Generates a UUIDv4 session token per "open" (reuses across autocomplete calls, consumes on the details call). Regenerates after selection.
   - Asks for `navigator.geolocation` **once** with a clear copy ("Use your location to find nearby restaurants?"). On deny, proceeds without bias.
   - Renders suggestions with primary + secondary text.
   - On select: calls `/api/places/resolve`, stores the result via `setResolvedPlace` in the store, and fills a read-only "Selected: {name} — {address}" row with a "Change" button.
5. Replace the restaurant name `Input` in `app/setup/page.tsx` with `<RestaurantCombobox />`. On submit, the form pulls `resolvedPlace` out of the store (instead of the old `restaurantName` state).
6. Fallback: if no `resolvedPlace` is set at submit time, allow guests to proceed with a plain free-text `restaurantName` (current behavior). Signed-in users are blocked with an inline error: "Pick a restaurant from the list so we can track your stats."
7. Handle the "can't find my restaurant" edge case: a "None of these — enter manually" action under the suggestion list that falls back to free-text and disables the signed-in save path (same inline error).

### Verification
- [ ] Typing "kbbq" in San Francisco returns actual nearby restaurants (verify manually in dev).
- [ ] Selecting one populates the Zustand store with a `resolvedPlace` object.
- [ ] The Google API key is **not** in the client bundle: `grep -r "GOOGLE_PLACES_API_KEY" .next/static` returns nothing.
- [ ] Rate limit returns 429 after 60 requests in a minute from the same IP.
- [ ] Guest mode still allows proceeding without picking a place.
- [ ] Cite the Places docs file/URL you used.

### Anti-pattern guards
- ❌ Don't hit Google Places directly from a `"use client"` file. Always via the Route Handler.
- ❌ Don't reuse a session token across unrelated searches — that breaks Google's billing model and will cost 10× more.
- ❌ Don't prefetch Place Details on every keystroke — details are expensive; fetch only on select.
- ❌ Don't cache Places results in `localStorage` — Google's ToS forbids storing the response beyond 30 days, and lat/lng can drift. Cache only the `place_id` and your own `restaurants` row.

---

## Phase 6 — Guest → user data migration on first sign-in

**Model tier:** default. **Depends on:** Phases 2, 3, 5.

### Context brief (cold-start)
A user may build up sessions in guest mode (Zustand + localStorage) and then create an account. We need a one-shot migration on sign-in that promotes *finished* guest sessions (those with `finishedAt` set) into `session_records`. In-progress guest buffers are left alone — migration happens after a clean finish.

### Tasks
1. Add an optional `finishedSessions: Session[]` array to the Zustand store, persisted. Update `finishMeal()` so guests push a deep copy of the session into `finishedSessions` (signed-in users skip this because their data already went to the DB).
2. Create a server action `promoteGuestSessions(sessions: Session[])` that:
   - Requires a signed-in user.
   - For each session: if `resolvedPlace` is missing, skip (and return it in a `skipped` array with reason "no_place").
   - Upserts the restaurant, inserts the record (reuse the Phase 3 helper).
   - Returns `{ inserted: number, skipped: { session: Session, reason: string }[] }`.
3. Create a client-side effect that runs exactly once on successful login:
   - Reads `finishedSessions` from the store.
   - Calls `promoteGuestSessions`.
   - On success, clears `finishedSessions` from the store.
   - Shows a toast: "Imported N past sessions — M skipped (no restaurant picked)".
4. For the "skipped" sessions, render a one-time `/import` page after login that lets the user pick a restaurant for each via the Phase 5 combobox and retry. Or, pragmatically, show the skipped list in a dismissable banner and let them re-enter manually.

### Verification
- [ ] Guest logs 3 sessions (2 with resolved places, 1 free-text), then signs up → 2 rows appear in `session_records`, 1 is surfaced in the "skipped" list.
- [ ] Running the migration twice does not double-insert (the effect clears `finishedSessions` on success).
- [ ] Signing out and back in does not re-trigger migration (store is empty).
- [ ] `npm run build` clean.

### Anti-pattern guards
- ❌ Don't run the migration inside a React render — use an effect gated on a "just logged in" flag.
- ❌ Don't delete `finishedSessions` before the server confirms success.
- ❌ Don't migrate sessions without `finishedAt` — those are in-progress and belong to guest buffer only.

---

## Phase 7 — Verification, tests, and polish

**Model tier:** default. **Depends on:** everything.

### Tasks
1. Unit tests:
   - `lib/calc.test.ts` — add a case covering `SessionRecord`-shaped inputs.
   - New `lib/db/stats.test.ts` with a mocked Supabase client — verify the query helpers return the expected shape.
   - `lib/supabase/admin.test.ts` — a static test that imports `admin.ts` and asserts it is not importable from a client context (use a magic comment check or `vitest`'s `.server.ts` convention — pick whichever is idiomatic in Phase 0 notes).
2. E2E tests (`e2e/`):
   - Split into two specs: `e2e/guest-path.spec.ts` (the original happy path, preserved) and `e2e/signed-in-path.spec.ts` (sign up → pick a restaurant → finish meal → appears in /history → /stats updates).
   - Use a dedicated test user seeded via the Supabase admin client in a global setup.
3. Grep gates (these must return zero):
   - `grep -rn " any" lib/ app/ components/ --include="*.ts" --include="*.tsx"`
   - `grep -rn "TODO\|FIXME" lib/ app/ components/ --include="*.ts" --include="*.tsx"`
   - `grep -rn "SUPABASE_SERVICE_ROLE_KEY\|GOOGLE_PLACES_API_KEY" app/ components/ lib/ | grep -v "lib/supabase/admin.ts\|app/api/places\|\.env"`
4. Build gates:
   - `npm run build` — clean, no warnings.
   - `npx playwright test` — all green.
   - `npm test` — all green.
5. Mobile review: every new page usable at 375px wide (login, signup, history, history detail, stats, combobox dropdown).
6. Manual: clear localStorage, sign up fresh, walk through start-to-finish, confirm win/loss numbers and restaurant name match.
7. Run `mcp__supabase__get_advisors` one more time (security + performance). Zero `ERROR` findings.

### Final acceptance
- [ ] Signed-in end-to-end journey (sign up → session with Places pick → finish → history → stats) passes E2E.
- [ ] Guest end-to-end journey (the original happy path) still passes.
- [ ] All grep gates clean.
- [ ] `npm run build`, `npm test`, `npx playwright test` all green.
- [ ] Advisors report zero `ERROR` findings.
- [ ] README.md updated with new env vars and a "Running with Supabase" section.

### Anti-pattern guards
- ❌ Don't skip mobile review.
- ❌ Don't suppress TS errors.
- ❌ Don't mock the DB for the signed-in E2E — hit a real Supabase preview project.

---

## Out-of-scope for this plan (explicitly deferred)

- Magic link auth.
- Social sharing of W/L records.
- Leaderboards or any social/multi-user feature beyond each user seeing their own data.
- Mapbox / OpenStreetMap fallback for Places.
- Photo upload per session.
- Importing Google Maps timeline history.
- Currencies other than USD.
- Restaurant ownership/claim flows ("is this your restaurant?").
- Tagging, favorites, or notes on restaurants beyond what the schema already has.

---

## Appendix A — Cost notes to flag to the user before Phase 5

Google Places API (New):
- Autocomplete (Session) calls are billed per *session*, not per keystroke — but only if a Place Details call using the same session token follows within ~3 minutes.
- Place Details (Basic SKU) is ~$5 per 1000 requests. The first ~$200 of usage is covered by Google's monthly free credit.
- **Recommendation:** enable billing with a $25 quota cap for safety. This is a human-only step.

## Appendix B — Anti-pattern watchlist (from adversarial review)

These are the failure modes a reviewer should look for in every PR of this plan:
1. Client component importing a server-only file.
2. Supabase query without RLS-aware client (accidentally using `admin.ts` in a normal request path).
3. Session records persisted from `useEffect` on a client page instead of a server action.
4. Reusing Google session tokens across unrelated searches.
5. Computing stats in JS instead of using the views.
6. Duplicating the calc math outside `lib/calc.ts`.
7. Breaking guest mode in pursuit of "logged-in only" semantics.
8. Caching Place Details response in localStorage / IndexedDB.
9. Storing `place_id` directly on `session_records` instead of going through `restaurants.id`.
10. Writing `any` "just for this one spot".

---

## Appendix C — Change log (plan mutation protocol)

Changes to this plan after initial draft:

| Date | Phase | Change | Reason |
|---|---|---|---|
| 2026-04-08 | — | Initial draft | Blueprint generation |
