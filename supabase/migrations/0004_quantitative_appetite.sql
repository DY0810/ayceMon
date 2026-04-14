-- Additive grams-based fields. Legacy fill_factor / appetite_budget columns
-- stay for one release so in-flight Zustand clients can finish their persisted
-- sessions without schema drift. Phase 8 may retire the legacy appetite_budget
-- column after a prod-data audit.

alter table public.session_records
  add column if not exists appetite_budget_grams numeric(8,2)
    check (appetite_budget_grams is null or appetite_budget_grams between 50 and 10000);

comment on column public.session_records.appetite_budget_grams is
  'Target grams of food mass for the session. NULL = user opted out of a budget. A later migration retires the legacy appetite_budget column.';

-- No new columns for item-level grams — the library jsonb already carries
-- whatever shape we pass. Phase 1 guarantees the client serialises
-- gramsPerUnit / grams into those blobs; no schema change needed.
