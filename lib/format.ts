// Grams formatter shared between the tracker and result pages.
//
// Plan task 4 nudged us to keep this inline and only extract on a third
// site. We extract at two sites because Phase 3's TDD contract calls for a
// vitest test on this helper — moving it to its own module is the smallest
// change that makes it importable without duplicating the spec in two
// places. If a third site ever needs a different rounding rule, fork then.
export function formatGrams(grams: number): string {
  return `${Math.round(grams)}g`;
}

// Phase 7: short user-id renderer for collaborator rosters. When a display
// name (e.g. email local-part) isn't available, show the first 8 chars of
// the user_id so the row has a glanceable handle. The sentinel
// "__unattributed__" is a grouping bucket used by /result and /history/[id]
// for entries that pre-date per-user attribution; it renders as literal
// "Unattributed". Tests in lib/format.test.ts anchor both branches.
export const UNATTRIBUTED_USER_ID = "__unattributed__";

export function shortUserId(userId: string): string {
  if (userId === UNATTRIBUTED_USER_ID) return "Unattributed";
  return userId.length >= 8 ? userId.slice(0, 8) : userId;
}
