-- Allow session_records to be saved without a restaurant. Signed-in users who
-- enter a restaurant name manually (no Google Places selection) can now finish
-- a meal and have it appear in history.

-- 1. Drop the NOT NULL constraint on restaurant_id.
alter table public.session_records
  alter column restaurant_id drop not null;

-- 2. Add a display-only restaurant_name column for sessions where no canonical
--    restaurant was resolved. When restaurant_id IS set, the canonical name
--    comes from the restaurants JOIN; this column is the fallback.
alter table public.session_records
  add column if not exists restaurant_name text;

-- 3. Change the FK action from RESTRICT to SET NULL so a deleted restaurant
--    doesn't block row cleanup.
alter table public.session_records
  drop constraint session_records_restaurant_id_fkey,
  add constraint session_records_restaurant_id_fkey
    foreign key (restaurant_id)
    references public.restaurants(id)
    on delete set null;
