-- Phase 6 (collab-and-quantitative-appetite): shared-session backbone.
--
-- Four new tables hold an *active* (not-yet-finished) session that multiple
-- signed-in users can collaborate on. Guest sessions and solo signed-in
-- sessions keep using Zustand — this schema only exists for the invite flow.
--
-- On finalize, `finalizeSharedSession` aggregates `shared_session_entries`
-- into a single `session_records` row (one per shared session) and stamps
-- the per-user attribution into the new `session_records.contributors`
-- jsonb column added at the bottom of this migration.
--
-- RLS follows the four-table matrix in the plan:
--   * shared_sessions            — owner OR collaborator reads; owner writes
--   * shared_session_items       — collaborator reads; owner writes
--   * shared_session_collaborators — collaborator reads; owner inserts;
--                                     user may delete their own row (leave)
--   * shared_session_entries     — collaborator reads own-session rows;
--                                     user may insert/update/delete rows
--                                     where user_id = auth.uid() AND they
--                                     are a collaborator on the session.
--
-- All policies use `(select auth.uid())` (not bare `auth.uid()`) so
-- Postgres caches the value per query instead of re-evaluating per row
-- (Supabase `auth_rls_initplan` advisor; Appendix B #5).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.shared_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  restaurant_id uuid references public.restaurants(id) on delete restrict,
  restaurant_name text,
  buffet_price numeric(10,2) not null check (buffet_price >= 0),
  appetite_budget int
    check (appetite_budget is null or appetite_budget between 1 and 100),
  appetite_budget_grams numeric(8,2)
    check (appetite_budget_grams is null
           or appetite_budget_grams between 50 and 10000),
  city_tier text
    check (city_tier is null
           or city_tier in ('metro-premium','metro-standard','suburban','rural')),
  resolved_place jsonb,
  started_at timestamptz not null,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.shared_sessions is
  'Active (or recently-finalized) shared session. One row per invite group. After finalize, a matching session_records row exists and this row stays for audit until cleanup.';

create index if not exists shared_sessions_owner_idx
  on public.shared_sessions(owner_user_id);
create index if not exists shared_sessions_restaurant_idx
  on public.shared_sessions(restaurant_id)
  where restaurant_id is not null;

-- Library items snapshot per shared session. Item.id is the client-generated
-- string key (uuid-ish) so we preserve Zustand semantics on the wire.
create table if not exists public.shared_session_items (
  session_id uuid not null
    references public.shared_sessions(id) on delete cascade,
  id text not null,
  name text not null check (length(name) between 1 and 200),
  ala_carte_value numeric(10,2) not null check (ala_carte_value >= 0),
  fill_factor numeric(6,2) not null check (fill_factor >= 0),
  grams_per_unit numeric(8,2)
    check (grams_per_unit is null
           or (grams_per_unit >= 0 and grams_per_unit <= 10000)),
  category text,
  source_kind text
    check (source_kind is null or source_kind in ('user','seed','estimate')),
  source_ref text,
  created_at timestamptz not null default now(),
  primary key (session_id, id)
);

-- Collaborator table. The owner has a row with role='owner' inserted at
-- session creation. Phase 7 invite redemption inserts role='collaborator'.
create table if not exists public.shared_session_collaborators (
  session_id uuid not null
    references public.shared_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'collaborator'
    check (role in ('owner','collaborator')),
  joined_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create index if not exists shared_session_collaborators_user_idx
  on public.shared_session_collaborators(user_id);

-- Per-user eaten entries. A surrogate uuid id lets the same (user, item)
-- log multiple entries in the same session without collision (e.g. the
-- user hits `+1` three separate times).
create table if not exists public.shared_session_entries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.shared_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  units numeric(8,2) not null check (units >= 0),
  grams numeric(8,2)
    check (grams is null or (grams >= 0 and grams <= 10000)),
  logged_at timestamptz not null default now(),
  foreign key (session_id, item_id)
    references public.shared_session_items(session_id, id)
    on delete cascade,
  foreign key (session_id, user_id)
    references public.shared_session_collaborators(session_id, user_id)
    on delete cascade
);

create index if not exists shared_session_entries_session_idx
  on public.shared_session_entries(session_id);
create index if not exists shared_session_entries_user_session_idx
  on public.shared_session_entries(user_id, session_id);

-- ---------------------------------------------------------------------------
-- session_records.contributors — per-user attribution baked into the
-- finalized record for cheap display on /history/[id]. Defaulted to []
-- so existing solo rows continue to validate (Appendix B #9).
-- ---------------------------------------------------------------------------
alter table public.session_records
  add column if not exists contributors jsonb not null default '[]'::jsonb;

comment on column public.session_records.contributors is
  'Per-collaborator attribution snapshot. Empty array for solo sessions. Shape: [{ userId, units, grams, valueEaten }]. Never trust on read — recompute from library/eaten when precision matters.';

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER helpers
--
-- RLS policies on `shared_session_collaborators` that reference the same
-- table (to check membership) would recurse — the inner query re-triggers
-- the same policy. These `security definer` functions run as their owner
-- (postgres) and therefore bypass RLS on the inner lookup, breaking the
-- cycle. They are the ONLY exceptions to "reads go through RLS" in this
-- schema; they read session membership only, no user data leaks out.
--
-- `stable` not `volatile` so Postgres can cache the result within a query.
-- ---------------------------------------------------------------------------
create or replace function public.is_shared_session_collaborator(
  p_session_id uuid,
  p_user_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.shared_session_collaborators
    where session_id = p_session_id
      and user_id = p_user_id
  );
$$;

create or replace function public.is_shared_session_owner(
  p_session_id uuid,
  p_user_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.shared_sessions
    where id = p_session_id
      and owner_user_id = p_user_id
  );
$$;

-- The helpers must not be callable by anonymous clients — they bypass
-- RLS by design. Restrict to authenticated role only.
revoke all on function public.is_shared_session_collaborator(uuid, uuid) from public;
revoke all on function public.is_shared_session_owner(uuid, uuid) from public;
grant execute on function public.is_shared_session_collaborator(uuid, uuid) to authenticated;
grant execute on function public.is_shared_session_owner(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.shared_sessions enable row level security;
alter table public.shared_session_items enable row level security;
alter table public.shared_session_collaborators enable row level security;
alter table public.shared_session_entries enable row level security;

-- -- shared_sessions -----------------------------------------------------

-- Owner or any collaborator may select the session row.
create policy shared_sessions_member_read
  on public.shared_sessions for select
  to authenticated
  using (
    (select auth.uid()) = owner_user_id
    or public.is_shared_session_collaborator(shared_sessions.id, (select auth.uid()))
  );

-- Only the caller may create a session for themselves.
create policy shared_sessions_owner_insert
  on public.shared_sessions for insert
  to authenticated
  with check ((select auth.uid()) = owner_user_id);

-- Only the owner may mutate session metadata.
create policy shared_sessions_owner_update
  on public.shared_sessions for update
  to authenticated
  using ((select auth.uid()) = owner_user_id)
  with check ((select auth.uid()) = owner_user_id);

create policy shared_sessions_owner_delete
  on public.shared_sessions for delete
  to authenticated
  using ((select auth.uid()) = owner_user_id);

-- -- shared_session_items -----------------------------------------------

-- Any collaborator (including owner) may read the library.
create policy shared_session_items_member_read
  on public.shared_session_items for select
  to authenticated
  using (
    public.is_shared_session_collaborator(shared_session_items.session_id, (select auth.uid()))
  );

-- Only the owner may add/update/remove library items.
create policy shared_session_items_owner_insert
  on public.shared_session_items for insert
  to authenticated
  with check (
    public.is_shared_session_owner(shared_session_items.session_id, (select auth.uid()))
  );

create policy shared_session_items_owner_update
  on public.shared_session_items for update
  to authenticated
  using (
    public.is_shared_session_owner(shared_session_items.session_id, (select auth.uid()))
  )
  with check (
    public.is_shared_session_owner(shared_session_items.session_id, (select auth.uid()))
  );

create policy shared_session_items_owner_delete
  on public.shared_session_items for delete
  to authenticated
  using (
    public.is_shared_session_owner(shared_session_items.session_id, (select auth.uid()))
  );

-- -- shared_session_collaborators --------------------------------------

-- Collaborators (including owner) may read the roster of their session.
-- Uses the SECURITY DEFINER helper to avoid RLS recursion on the self-join.
create policy shared_session_collaborators_member_read
  on public.shared_session_collaborators for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_shared_session_collaborator(
         shared_session_collaborators.session_id,
         (select auth.uid())
       )
  );

-- Only the session owner may add a collaborator row. This is the hook
-- Phase 7's invite redemption will use (via a SECURITY DEFINER function;
-- direct insert from a non-owner is blocked here).
create policy shared_session_collaborators_owner_insert
  on public.shared_session_collaborators for insert
  to authenticated
  with check (
    public.is_shared_session_owner(
      shared_session_collaborators.session_id,
      (select auth.uid())
    )
  );

-- A collaborator may delete their own row (leave). The owner may also
-- delete any collaborator row on their session (kick). Owner cannot
-- remove themselves via this policy — cascade delete the session instead.
create policy shared_session_collaborators_self_or_owner_delete
  on public.shared_session_collaborators for delete
  to authenticated
  using (
    (
      user_id = (select auth.uid())
      and role <> 'owner'
    )
    or public.is_shared_session_owner(
         shared_session_collaborators.session_id,
         (select auth.uid())
       )
  );

-- -- shared_session_entries --------------------------------------------

-- A collaborator may read every entry on sessions they belong to.
-- The owner therefore sees all entries on their session by virtue of
-- being a collaborator (role='owner') themselves.
create policy shared_session_entries_member_read
  on public.shared_session_entries for select
  to authenticated
  using (
    public.is_shared_session_collaborator(shared_session_entries.session_id, (select auth.uid()))
  );

-- A user may insert an entry only for themselves, and only for sessions
-- they are a collaborator on. This is the invariant #14 guard: we do
-- NOT trust client-supplied user_id — the WITH CHECK forces it to equal
-- auth.uid() server-side.
create policy shared_session_entries_self_insert
  on public.shared_session_entries for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_shared_session_collaborator(shared_session_entries.session_id, (select auth.uid()))
  );

-- A user may update or delete only their own entries. Prevents a
-- collaborator from editing another collaborator's logged rows.
create policy shared_session_entries_self_update
  on public.shared_session_entries for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy shared_session_entries_self_delete
  on public.shared_session_entries for delete
  to authenticated
  using (user_id = (select auth.uid()));
