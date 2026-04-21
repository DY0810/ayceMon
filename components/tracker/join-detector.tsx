"use client";

import { useEffect, useRef } from "react";

import { useToastManager } from "@/components/ui/toast";
import { shortUserId } from "@/lib/format";
import { diffJoinedUserIds } from "@/lib/roster-diff";

// Phase 7 (multi-user-tracking-k8s-brand): headless roster-diff detector.
// Consumes the polled collaborator list and fires a toast per newly-seen
// collaborator. First-mount snapshot is seeded without firing, so pre-
// existing members (the owner, anyone already in when we land on /tracker)
// do NOT trigger toasts — only joins that happen while the user watches.
//
// Self-join is suppressed: the current user's own join event shouldn't
// notify them. (In the invite-redeem flow this isn't reachable because
// the collaborator row lands server-side before the redeemer's tracker
// mounts, but the guard is explicit so intent is obvious at the call site.)

interface JoinDetectorProps {
  /** The polled collaborator roster (from useSharedSession). */
  collaborators: ReadonlyArray<{ user_id: string; role: string }>;
  /** user_id → display-name map. Missing entries fall back to the short
   *  user_id prefix via `shortUserId`. */
  displayNameById: ReadonlyMap<string, string>;
  /** Current user's auth id — null while auth is still resolving or in
   *  guest mode. Used to suppress self-join toasts. */
  selfUserId: string | null;
}

export function JoinDetector({
  collaborators,
  displayNameById,
  selfUserId,
}: JoinDetectorProps) {
  // `add` is `store.addToast` — a stable class method whose identity
  // does NOT change when the toast list updates, even though the memo
  // object returned by `useToastManager` does. Destructuring here lets
  // us pass a stable reference to the effect's dep array without
  // triggering a spurious re-run after every toast.add() call.
  const { add } = useToastManager();
  // Mount-time seed. `null` until the first effect run replaces it with
  // the initial roster snapshot. Subsequent runs diff against it.
  const seenRef = useRef<Set<string> | null>(null);

  // Stable effect key: sorted, comma-joined user_ids. Matches the pattern
  // already used by /tracker page.tsx's `collaboratorIdsKey`. Using this
  // as the dep instead of the `collaborators` array reference pins the
  // effect to actual membership changes; the hook returns a fresh array
  // object on every poll (every 2.5s) even when the set is unchanged.
  const rosterKey = collaborators
    .map((c) => c.user_id)
    .sort()
    .join(",");

  useEffect(() => {
    const current = new Set(
      rosterKey.length > 0 ? rosterKey.split(",") : [],
    );
    const { joined, nextSeen } = diffJoinedUserIds(
      seenRef.current,
      current,
      selfUserId,
    );
    seenRef.current = nextSeen;
    for (const userId of joined) {
      const name = displayNameById.get(userId) ?? shortUserId(userId);
      add({ title: `${name} joined` });
    }
  }, [rosterKey, selfUserId, displayNameById, add]);

  return null;
}
