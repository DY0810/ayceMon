import type { EatenEntry, Item, Session } from "./types";

/**
 * The single source of truth for session math. Both the in-progress
 * `Session`-shaped helpers below and the Phase 3 `finishAndSaveSession`
 * server action delegate to this — never duplicate the math elsewhere
 * (see plans/user-auth-history-places.md, Appendix B #14).
 */
export function computeTotals(
  library: Item[],
  eaten: EatenEntry[],
  buffetPrice: number,
): { total: number; margin: number; won: boolean } {
  const lookup = new Map(library.map((i) => [i.id, i.alaCarteValue]));
  const total = eaten.reduce((sum, entry) => {
    const value = lookup.get(entry.itemId);
    return value === undefined ? sum : sum + value * entry.units;
  }, 0);
  const marginValue = total - buffetPrice;
  return { total, margin: marginValue, won: total >= buffetPrice };
}

export function totalEatenValue(session: Session): number {
  return computeTotals(session.library, session.eaten, session.buffetPrice).total;
}

export function margin(session: Session): number {
  return computeTotals(session.library, session.eaten, session.buffetPrice).margin;
}

export function didYouWin(session: Session): boolean {
  return computeTotals(session.library, session.eaten, session.buffetPrice).won;
}

/**
 * Grams-based fullness (plans/collab-and-quantitative-appetite.md, Phase 1).
 * Single source of truth for the new fullness progress bar — the legacy
 * fillFactor math stays in place until Phase 3 retires it.
 *
 * Per-entry gram contribution is resolved in this order:
 *   1. `entry.grams` — direct override, wins when set and finite.
 *   2. `entry.units * item.gramsPerUnit` — when both are finite.
 *   3. otherwise contributes 0 (no throw, no NaN). Items removed from the
 *      library are also treated as zero-contributing.
 *
 * `percent` is `(grams / budgetGrams) * 100` when a positive budget is
 * supplied. `null`/undefined budget (user opted out) or a non-positive
 * budget yields `percent = 0` so callers can render a neutral progress
 * bar. The value is intentionally *not* clamped at 100 — the budget is
 * a comfort-ceiling target, not a hard cap (Appendix B #13).
 */
export function computeFullness(
  library: Item[],
  eaten: EatenEntry[],
  budgetGrams: number | null | undefined,
): { grams: number; percent: number } {
  const gramsPerUnitById = new Map(
    library.map((item) => [item.id, item.gramsPerUnit]),
  );
  const grams = eaten.reduce((sum, entry) => {
    if (typeof entry.grams === "number" && Number.isFinite(entry.grams)) {
      return sum + entry.grams;
    }
    const gramsPerUnit = gramsPerUnitById.get(entry.itemId);
    if (
      typeof gramsPerUnit === "number" &&
      Number.isFinite(gramsPerUnit) &&
      typeof entry.units === "number" &&
      Number.isFinite(entry.units)
    ) {
      return sum + entry.units * gramsPerUnit;
    }
    return sum;
  }, 0);
  const percent =
    typeof budgetGrams === "number" &&
    Number.isFinite(budgetGrams) &&
    budgetGrams > 0
      ? (grams / budgetGrams) * 100
      : 0;
  return { grams, percent };
}
