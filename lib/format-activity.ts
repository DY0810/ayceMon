// Display-layer formatters for the /tracker activity feed (Phase 6).
// Kept module-private from the component so both branches of each
// helper can be tested in isolation — the boundaries around the
// "just now" → "1m ago" transition and the minute→hour cascade are
// exactly where off-by-one rounding bugs hide.

// Module-level singleton. Intl objects are expensive to construct and
// stateless — caching avoids the per-call allocation a hot row formatter
// would otherwise pay. Locale is pinned to "en" so the output format is
// consistent with the rest of the app, which uses untranslated English
// literals ("g", "just now", "Over share" badges, etc.) — and so CI
// runs on non-English images still match the test regexes.
// `numeric: "always"` forces "1m ago" / "1d ago" output; the default
// `"auto"` mode would substitute natural-language words ("this minute",
// "yesterday") that make the row formatter inconsistent across unit
// boundaries.
const RTF = new Intl.RelativeTimeFormat("en", {
  numeric: "always",
  style: "narrow",
});

/** "×N" column for an activity row. Grams-only entries (units=0 +
 *  grams>0) come from the tracker's `+g` flow and would otherwise render
 *  as "×0" — show the gram weight instead so the row still communicates
 *  *what* was logged. */
export function formatActivityUnits(
  units: number,
  grams: number | null,
): string {
  if (units === 0 && grams !== null && grams > 0) {
    return `${Math.round(grams)}g`;
  }
  return `×${Number.isInteger(units) ? units : units.toFixed(1)}`;
}

/** Relative-time label for an activity row.
 *
 *  Sub-60s renders as "just now" to avoid the jumpy "5s ago → 10s ago"
 *  ticks RelativeTimeFormat would produce *and* to sidestep the "0m
 *  ago" that `numeric: "always"` would emit for 45–59s deltas. At 60s
 *  exactly, diffMin = 1 → "1m ago", which is the plan's target
 *  transition.
 *
 *  Each unit is derived from `diffSec` with `Math.floor` (not a rounded
 *  cascade from the unit below), so a 59m 30s delta lands on "59m ago"
 *  and only advances to "1h ago" at 60 full minutes — otherwise the
 *  chained rounding would jump units 30 seconds early at each boundary. */
export function formatActivityRelative(
  loggedAtIso: string,
  now: number,
): string {
  const then = Date.parse(loggedAtIso);
  if (!Number.isFinite(then)) return "";
  const diffSec = Math.max(0, Math.floor((now - then) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return RTF.format(-diffMin, "minute");
  const diffHr = Math.floor(diffSec / 3600);
  if (diffHr < 24) return RTF.format(-diffHr, "hour");
  const diffDay = Math.floor(diffSec / 86400);
  return RTF.format(-diffDay, "day");
}
