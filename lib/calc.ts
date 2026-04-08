import type { Session } from "./types";

export function totalEatenValue(session: Session): number {
  const lookup = new Map(session.library.map((i) => [i.id, i.alaCarteValue]));
  return session.eaten.reduce((sum, entry) => {
    const value = lookup.get(entry.itemId);
    return value === undefined ? sum : sum + value * entry.units;
  }, 0);
}

export function margin(session: Session): number {
  return totalEatenValue(session) - session.buffetPrice;
}

export function didYouWin(session: Session): boolean {
  return totalEatenValue(session) >= session.buffetPrice;
}
