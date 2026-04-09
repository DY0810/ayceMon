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
