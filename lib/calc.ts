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
