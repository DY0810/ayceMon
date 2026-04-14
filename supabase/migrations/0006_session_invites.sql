-- Phase 7 (collab-and-quantitative-appetite): invite/join flow.
--
-- One new table — `session_invites` — holds opaque DB-key invite tokens.
-- Each token is a 128-bit random value (base64url-encoded, 22 chars)
-- generated server-side in lib/invite.ts#generateInviteToken. The token
-- is NOT a JWT: it carries no session data, only acts as an opaque lookup
-- key into this table. See Appendix B invariant #15 and Phase 7's threat
-- model in the PR description.
--
-- Lifecycle:
--   1. Owner calls createInvite → row with used_at = NULL inserted.
--   2. Invitee hits /join?token=… → server action calls the SECURITY
--      DEFINER function `redeem_session_invite(token)` which atomically
--      validates + inserts a shared_session_collaborators row + stamps
--      used_at.
--   3. Owner can revokeInvite → sets used_at = now() without inserting
--      a collaborator (soft delete preserves audit trail).
--
-- RLS matrix:
--   SELECT  — owner of the parent session only.
--   INSERT  — owner of the parent session (auth.uid() = created_by AND
--             is_shared_session_owner(session_id, auth.uid())).
--   UPDATE  — owner only (for revokeInvite / diagnostic writes).
--   DELETE  — owner only.
--
-- The `used_at` write by a non-owner invitee happens through the
-- SECURITY DEFINER helper, which bypasses RLS by design. That function
-- is the ONLY path allowed to flip `used_at` on an invite the caller
-- doesn't own; direct updates by non-owners are blocked by RLS.
--
-- The `contributors jsonb` column on session_records was added in
-- 0005_shared_sessions.sql (grep: `alter table public.session_records
-- add column if not exists contributors jsonb`). DO NOT re-add here.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.session_invites (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.shared_sessions(id) on delete cascade,
  token text not null unique check (length(token) between 16 and 64),
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.session_invites is
  'Opaque invite tokens minted by a shared-session owner. Single-use (used_at stamp) + 24h expiry by default. Token is a 128-bit CSPRNG value (base64url, 22 chars), never a JWT.';

-- Lookup by token — the redeem path hits this on every /join.
-- `unique` on `token` already implies an index, but name it explicitly
-- for legibility and so future migrations can drop/recreate if needed.
create index if not exists session_invites_token_idx
  on public.session_invites(token);

-- Owner queries their invites by session.
create index if not exists session_invites_session_idx
  on public.session_invites(session_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.session_invites enable row level security;

-- SELECT — only the session owner. The invitee never reads invite rows
-- directly; they hand the token to `redeem_session_invite` (SECURITY
-- DEFINER) which bypasses RLS for the membership-insert side effects.
create policy session_invites_owner_read
  on public.session_invites for select
  to authenticated
  using (
    public.is_shared_session_owner(
      session_invites.session_id,
      (select auth.uid())
    )
  );

-- INSERT — only the owner, and `created_by` MUST be `auth.uid()` so the
-- audit trail can't be forged from the client (invariant #14).
create policy session_invites_owner_insert
  on public.session_invites for insert
  to authenticated
  with check (
    (select auth.uid()) = created_by
    and public.is_shared_session_owner(
      session_invites.session_id,
      (select auth.uid())
    )
  );

-- UPDATE — only the owner. Used by revokeInvite (sets used_at).
-- NOTE: the SECURITY DEFINER redeem function bypasses this policy by
-- design — that's how invitees can mark tokens used without being owner.
create policy session_invites_owner_update
  on public.session_invites for update
  to authenticated
  using (
    public.is_shared_session_owner(
      session_invites.session_id,
      (select auth.uid())
    )
  )
  with check (
    public.is_shared_session_owner(
      session_invites.session_id,
      (select auth.uid())
    )
  );

-- DELETE — only the owner (hard delete; revokeInvite uses soft-delete
-- via UPDATE to preserve audit trail).
create policy session_invites_owner_delete
  on public.session_invites for delete
  to authenticated
  using (
    public.is_shared_session_owner(
      session_invites.session_id,
      (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- redeem_session_invite — SECURITY DEFINER
--
-- Atomic invite redemption: looks up the token, validates expiry +
-- used_at + session.finished_at, inserts a collaborator row, and stamps
-- used_at — all inside one function so the three writes happen together.
--
-- Returns a jsonb `{ error, session_id }`. `error` is one of:
--   'invite_not_found'  — no row matches the token
--   'invite_expired'    — expires_at <= now()
--   'invite_already_used' — used_at IS NOT NULL
--   'session_finalized' — shared_sessions.finished_at IS NOT NULL
--   'already_collaborator' — caller already belongs to the session
--   null                — success; session_id is set
--
-- SECURITY DEFINER: runs as the function owner (postgres), so the
-- INSERT into shared_session_collaborators and the UPDATE of
-- session_invites happen without tripping RLS (which would otherwise
-- block a non-owner invitee from writing either row). The function
-- still enforces auth.uid() IS NOT NULL — only authenticated callers
-- can redeem.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_session_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite_id uuid;
  v_session_id uuid;
  v_expires_at timestamptz;
  v_used_at timestamptz;
  v_finished_at timestamptz;
  v_user_id uuid := (select auth.uid());
  v_existing uuid;
begin
  if v_user_id is null then
    return jsonb_build_object('error', 'unauthenticated');
  end if;

  -- Lock the invite row for the duration of the tx so concurrent
  -- redemptions of the same token serialise. The SELECT … FOR UPDATE
  -- holds the lock until commit; a second caller blocks until the
  -- first finishes, then sees used_at = <timestamp> and returns
  -- 'invite_already_used'.
  select id, session_id, expires_at, used_at
    into v_invite_id, v_session_id, v_expires_at, v_used_at
    from public.session_invites
    where token = p_token
    for update;

  if not found then
    return jsonb_build_object('error', 'invite_not_found');
  end if;

  if v_used_at is not null then
    return jsonb_build_object('error', 'invite_already_used');
  end if;

  if v_expires_at <= now() then
    return jsonb_build_object('error', 'invite_expired');
  end if;

  -- Session-finalized check. Lock the shared_sessions row so a
  -- concurrent `finalizeSharedSession` can't commit between this check
  -- and the collaborator insert below (security review T4). The lock
  -- releases on commit; finalize has to wait for us, and if we see
  -- `finished_at IS NOT NULL` under the lock the session has already
  -- been closed and we refuse the join.
  select finished_at into v_finished_at
    from public.shared_sessions
    where id = v_session_id
    for update;

  if v_finished_at is not null then
    return jsonb_build_object('error', 'session_finalized');
  end if;

  -- Idempotency guard: if the caller is already on the session (e.g.
  -- the owner accidentally redeems their own link), we still mark the
  -- invite used and return success with the session id so the UI
  -- navigates correctly. No duplicate collaborator row.
  select user_id into v_existing
    from public.shared_session_collaborators
    where session_id = v_session_id
      and user_id = v_user_id;

  if v_existing is null then
    insert into public.shared_session_collaborators (
      session_id, user_id, role
    ) values (
      v_session_id, v_user_id, 'collaborator'
    );
  end if;

  update public.session_invites
    set used_at = now()
    where id = v_invite_id;

  return jsonb_build_object(
    'error', null,
    'session_id', v_session_id
  );
end;
$$;

-- Restrict to authenticated callers only — anonymous clients cannot
-- redeem. The `invoker` / caller is what auth.uid() reads; `security
-- definer` only governs whose privileges run the body.
revoke all on function public.redeem_session_invite(text) from public;
grant execute on function public.redeem_session_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- get_shared_session_collaborator_names — SECURITY DEFINER
--
-- Returns display names (email local-part — the piece before `@`) for
-- every collaborator on a shared session. The calling user MUST be a
-- collaborator on the session themselves — the function no-ops (returns
-- empty set) for callers outside the membership. Leaks only first-name
-- style email prefixes, not the full email address; the server route
-- therefore can't be used to enumerate other users' contact info even
-- by a session owner.
--
-- Why SECURITY DEFINER: `auth.users` is owned by supabase_auth_admin
-- and not readable via standard RLS from the `authenticated` role. The
-- definer bypass reads one row per collaborator; the membership guard
-- limits exposure to sessions the caller already belongs to.
-- ---------------------------------------------------------------------------
create or replace function public.get_shared_session_collaborator_names(
  p_session_id uuid
) returns table (user_id uuid, display_name text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null then
    return;
  end if;

  -- Membership gate: if the caller is not a collaborator on the session,
  -- return empty. Uses the existing helper rather than a fresh EXISTS
  -- for consistency with other callers.
  if not public.is_shared_session_collaborator(p_session_id, v_caller) then
    return;
  end if;

  return query
    select
      c.user_id,
      -- email-local-part — everything before the first `@`. Fallback to
      -- 'member' when the email is absent or malformed so callers always
      -- render something human-readable.
      coalesce(
        nullif(split_part(u.email, '@', 1), ''),
        'member'
      ) as display_name
    from public.shared_session_collaborators c
    join auth.users u on u.id = c.user_id
    where c.session_id = p_session_id;
end;
$$;

revoke all on function public.get_shared_session_collaborator_names(uuid) from public;
grant execute on function public.get_shared_session_collaborator_names(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- session_records — collaborator read policy
--
-- Phase 6 finalized shared sessions into a single session_records row
-- owned by the shared-session OWNER. Collaborators never owned a row,
-- so under 0001's `auth.uid() = user_id` SELECT policy they can't see
-- the post-meal `/history/[id]` page. Phase 7 adds a second SELECT
-- policy that OR's in shared-session membership: if the row's
-- `client_session_id` matches a `shared_sessions.id` the caller was a
-- collaborator on, they may read it.
--
-- Postgres combines SELECT policies with OR, so the existing
-- `session_records_own_read` keeps letting owners read their own
-- rows; this new policy only adds reads for shared-session members.
-- Writes (insert/update/delete) are unchanged — still owner-only.
--
-- Both `shared_sessions.id` and `session_records.client_session_id` are
-- uuid (see 0001_init.sql), so the join is a direct equality.
-- ---------------------------------------------------------------------------
create policy session_records_shared_collaborator_read
  on public.session_records for select
  to authenticated
  using (
    exists (
      select 1
      from public.shared_sessions ss
      where ss.id = session_records.client_session_id
        and public.is_shared_session_collaborator(
              ss.id,
              (select auth.uid())
            )
    )
  );
