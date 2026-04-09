-- Supabase advisor fixes for the 0001_init schema.
--
-- 1. Wrap auth.uid() calls with (select auth.uid()) in session_records
--    policies so Postgres caches the value per query instead of
--    re-evaluating per row (auth_rls_initplan — Supabase best practice).
-- 2. Add a covering index on session_records.restaurant_id (the FK
--    session_records_restaurant_id_fkey advisor INFO).
--
-- No behavior change: the policies still only match rows where the
-- caller's auth.uid() equals user_id.

drop policy if exists session_records_own_read on public.session_records;
drop policy if exists session_records_own_write on public.session_records;
drop policy if exists session_records_own_update on public.session_records;
drop policy if exists session_records_own_delete on public.session_records;

create policy session_records_own_read
  on public.session_records for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy session_records_own_write
  on public.session_records for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy session_records_own_update
  on public.session_records for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy session_records_own_delete
  on public.session_records for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create index if not exists session_records_restaurant_id_idx
  on public.session_records(restaurant_id);
