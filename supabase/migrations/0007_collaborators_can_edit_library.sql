-- 0007_collaborators_can_edit_library.sql
--
-- Allow any collaborator on a shared session (not just the owner) to add,
-- update, and remove library items. Original 0005 scoped these to the
-- owner because the plan assumed only the session starter would curate
-- the à la carte list — but in practice, friends want to contribute
-- their own picks to the shared library.
--
-- The helper `is_shared_session_collaborator(session_id, user_id)` returns
-- TRUE for the owner too (who receives a role='owner' row in
-- shared_session_collaborators at session creation — see 0005 line ~96),
-- so swapping policies from the owner-only helper to the collaborator
-- helper preserves owner access and adds collaborator access.
--
-- Read access was already collaborator-scoped, so we leave
-- `shared_session_items_member_read` untouched.

-- Drop the three owner-only write policies from 0005 ---------------------
drop policy if exists shared_session_items_owner_insert
  on public.shared_session_items;
drop policy if exists shared_session_items_owner_update
  on public.shared_session_items;
drop policy if exists shared_session_items_owner_delete
  on public.shared_session_items;

-- Re-create as collaborator policies -------------------------------------
create policy shared_session_items_collaborator_insert
  on public.shared_session_items for insert
  to authenticated
  with check (
    public.is_shared_session_collaborator(
      shared_session_items.session_id,
      (select auth.uid())
    )
  );

create policy shared_session_items_collaborator_update
  on public.shared_session_items for update
  to authenticated
  using (
    public.is_shared_session_collaborator(
      shared_session_items.session_id,
      (select auth.uid())
    )
  )
  with check (
    public.is_shared_session_collaborator(
      shared_session_items.session_id,
      (select auth.uid())
    )
  );

create policy shared_session_items_collaborator_delete
  on public.shared_session_items for delete
  to authenticated
  using (
    public.is_shared_session_collaborator(
      shared_session_items.session_id,
      (select auth.uid())
    )
  );
