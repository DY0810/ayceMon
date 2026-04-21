import { shortUserId } from "./format";
import type { LiveActivityEvent } from "./types";

// Pure join of the raw shared-session payload into a list of per-entry
// events suitable for the /tracker activity feed (Phase 6). Mirrors the
// shape of `aggregate-contributors.ts` so both derivations live in pure
// helpers the polling hook can fold into its return value.
//
// Output is sorted reverse-chronological (newest first). ISO-8601 strings
// sort lexicographically the same as chronologically, so `localeCompare`
// is safe — *provided* every timestamp shares the same timezone suffix.
// In practice `shared_session_entries.logged_at` is a `timestamptz`
// defaulted to `now()` and serialized by supabase-js as `+00:00`, so the
// suffix is uniform. If a future code path ever surfaces a `Z`-suffixed
// or non-UTC-offset timestamp, the string sort would silently break (the
// ASCII codepoints `+` (43), `-` (45), and `Z` (90) would interleave
// entries with different offsets incorrectly) — at that point switch to
// Date.parse-based numeric comparison. `entryId` is the secondary key
// so two entries with identical timestamps produce a stable order across
// polls — without that, the row order could flip between renders and
// cause visual jitter.

export interface AggregateActivityInput {
  items: ReadonlyArray<{
    id: string;
    name: string;
  }>;
  entries: ReadonlyArray<{
    id: string;
    user_id: string;
    item_id: string;
    units: string | number;
    grams: string | number | null;
    logged_at: string;
  }>;
}

export function aggregateActivity(
  data: AggregateActivityInput,
  displayNameById?: ReadonlyMap<string, string>,
): LiveActivityEvent[] {
  const itemNameById = new Map<string, string>();
  for (const item of data.items) itemNameById.set(item.id, item.name);

  const events: LiveActivityEvent[] = [];
  for (const e of data.entries) {
    const units = Number(e.units);
    if (!Number.isFinite(units)) continue;

    let grams: number | null = null;
    if (e.grams !== null) {
      const g = Number(e.grams);
      if (Number.isFinite(g)) grams = g;
    }

    events.push({
      entryId: e.id,
      userId: e.user_id,
      displayName: displayNameById?.get(e.user_id) ?? shortUserId(e.user_id),
      itemId: e.item_id,
      itemName: itemNameById.get(e.item_id) ?? "Unknown item",
      units,
      grams,
      loggedAt: e.logged_at,
    });
  }

  events.sort((a, b) => {
    const byTime = b.loggedAt.localeCompare(a.loggedAt);
    return byTime !== 0 ? byTime : b.entryId.localeCompare(a.entryId);
  });
  return events;
}
