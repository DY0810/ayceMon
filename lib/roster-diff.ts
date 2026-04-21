// Phase 7 (multi-user-tracking-k8s-brand): pure helper for the join-toast
// roster-diff. Pulled out of components/tracker/join-detector.tsx so the
// branch logic (mount-seed, self-suppress, multi-join) is unit-testable
// without mounting React. The detector is still the only caller; keep it
// that way unless a second surface needs the same shape.

/** Diff the current roster against the previously-seen snapshot.
 *
 *  - `prev === null` signals the mount-time seed: no joins fired, the
 *    returned `nextSeen` is the mount snapshot.
 *  - `prev` set → returns every user_id in `current` that wasn't in `prev`,
 *    excluding `selfUserId` (so the user never gets a toast for their
 *    own join event).
 *  - `nextSeen` always mirrors `current` so the caller can write it back
 *    to its ref unconditionally, regardless of which branch fired. */
export function diffJoinedUserIds(
  prev: ReadonlySet<string> | null,
  current: ReadonlySet<string>,
  selfUserId: string | null,
): { joined: string[]; nextSeen: Set<string> } {
  const nextSeen = new Set(current);
  if (prev === null) {
    return { joined: [], nextSeen };
  }
  const joined: string[] = [];
  for (const userId of current) {
    if (prev.has(userId)) continue;
    if (userId === selfUserId) continue;
    joined.push(userId);
  }
  return { joined, nextSeen };
}
