import type { Item, ItemId, Session } from "./types";

export interface ComboPick {
  itemId: ItemId;
  units: number;
}

export interface ComboSuggestion {
  picks: ComboPick[];
  totalValue: number;
  totalFill: number;
}

const MAX_UNITS_PER_ITEM = 10;

// DP cost is O(n * capacity * MAX_UNITS_PER_ITEM). At the spec ceiling
// (n=50, capacity=200, units=10) that is 100k ops — well within budget.
// Above this we fall back to greedy by value-density to keep latency bounded.
const DP_CAPACITY_THRESHOLD = 200;

const EMPTY: ComboSuggestion = { picks: [], totalValue: 0, totalFill: 0 };

/**
 * Returns the highest-value combo of library items whose total fillFactor
 * is within `session.appetiteBudget`. Bounded knapsack: at most
 * MAX_UNITS_PER_ITEM units of any single item. Whole units only — fractional
 * tracking belongs to the live tracker, not the pre-meal suggester.
 */
export function suggestCombo(session: Session): ComboSuggestion {
  return solve(session.library, session.appetiteBudget, new Map());
}

/**
 * Returns up to `n` *diverse* combos. The first is the unconstrained optimum;
 * subsequent combos are produced by force-including 1 unit of each
 * highest-value item in turn, then re-optimizing the remaining capacity.
 * Duplicate suggestions are de-duplicated by their picks signature.
 */
export function suggestTopN(session: Session, n: number): ComboSuggestion[] {
  if (n <= 0) return [];
  const baseline = suggestCombo(session);
  const out: ComboSuggestion[] = [];
  const seen = new Set<string>();

  function tryAdd(combo: ComboSuggestion): void {
    if (out.length >= n) return;
    const sig = signature(combo);
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push(combo);
  }

  tryAdd(baseline);

  const anchors = [...session.library].sort((a, b) => {
    if (b.alaCarteValue !== a.alaCarteValue) {
      return b.alaCarteValue - a.alaCarteValue;
    }
    return a.fillFactor - b.fillFactor;
  });

  for (const anchor of anchors) {
    if (out.length >= n) break;
    if (anchor.fillFactor <= 0) continue;
    if (anchor.fillFactor > session.appetiteBudget) continue;
    const forced = new Map<ItemId, number>([[anchor.id, 1]]);
    tryAdd(solve(session.library, session.appetiteBudget, forced));
  }

  return out;
}

function solve(
  library: readonly Item[],
  capacity: number,
  forced: Map<ItemId, number>
): ComboSuggestion {
  if (library.length === 0 || capacity <= 0) {
    return { ...EMPTY, picks: [] };
  }

  // Apply forced picks up front and shrink the remaining capacity.
  let usedCapacity = 0;
  let usedValue = 0;
  const forcedPicks: ComboPick[] = [];
  for (const [itemId, units] of forced) {
    const item = library.find((i) => i.id === itemId);
    if (!item) continue;
    if (item.fillFactor <= 0) continue;
    const u = Math.max(0, Math.min(MAX_UNITS_PER_ITEM, Math.floor(units)));
    if (u === 0) continue;
    const cost = item.fillFactor * u;
    if (cost > capacity - usedCapacity) {
      // Forced pick can't fit alongside the others — variant is infeasible.
      return { ...EMPTY, picks: [] };
    }
    usedCapacity += cost;
    usedValue += item.alaCarteValue * u;
    forcedPicks.push({ itemId, units: u });
  }

  const remaining = capacity - usedCapacity;
  if (remaining <= 0) {
    return {
      picks: forcedPicks,
      totalValue: usedValue,
      totalFill: usedCapacity,
    };
  }

  const optimized =
    capacity > DP_CAPACITY_THRESHOLD
      ? greedySolve(library, remaining, forced)
      : dpSolve(library, remaining, forced);

  return {
    picks: mergePicks(forcedPicks, optimized.picks),
    totalValue: usedValue + optimized.totalValue,
    totalFill: usedCapacity + optimized.totalFill,
  };
}

function dpSolve(
  library: readonly Item[],
  remaining: number,
  forced: Map<ItemId, number>
): ComboSuggestion {
  const n = library.length;
  // dp[w] = best value achievable with weight ≤ w using items processed so far.
  const dp = new Array<number>(remaining + 1).fill(0);
  // choice[i][w] = units of item i picked when arriving at this dp cell.
  const choice: number[][] = Array.from({ length: n }, () =>
    new Array<number>(remaining + 1).fill(0)
  );

  for (let i = 0; i < n; i++) {
    const item = library[i];
    const wt = item.fillFactor;
    const val = item.alaCarteValue;
    if (wt <= 0) continue;
    const forcedUnits = forced.get(item.id) ?? 0;
    const cap = Math.max(0, MAX_UNITS_PER_ITEM - forcedUnits);
    if (cap <= 0) continue;
    const maxUnits = Math.min(cap, Math.floor(remaining / wt));
    if (maxUnits <= 0) continue;

    const next = dp.slice();
    for (let w = wt; w <= remaining; w++) {
      let bestVal = dp[w];
      let bestK = 0;
      const kLimit = Math.min(maxUnits, Math.floor(w / wt));
      for (let k = 1; k <= kLimit; k++) {
        const candidate = dp[w - k * wt] + k * val;
        if (candidate > bestVal) {
          bestVal = candidate;
          bestK = k;
        }
      }
      next[w] = bestVal;
      choice[i][w] = bestK;
    }
    for (let w = 0; w <= remaining; w++) dp[w] = next[w];
  }

  // The optimum may sit at any weight ≤ remaining (slack is allowed).
  let bestW = 0;
  let bestValue = dp[0];
  for (let w = 1; w <= remaining; w++) {
    if (dp[w] > bestValue) {
      bestValue = dp[w];
      bestW = w;
    }
  }

  const picks: ComboPick[] = [];
  let w = bestW;
  for (let i = n - 1; i >= 0; i--) {
    const k = choice[i]?.[w] ?? 0;
    if (k > 0) {
      picks.push({ itemId: library[i].id, units: k });
      w -= k * library[i].fillFactor;
    }
  }
  picks.reverse();

  return {
    picks,
    totalValue: bestValue,
    totalFill: bestW - w,
  };
}

function greedySolve(
  library: readonly Item[],
  remaining: number,
  forced: Map<ItemId, number>
): ComboSuggestion {
  const ranked = [...library]
    .filter((i) => i.fillFactor > 0)
    .sort((a, b) => b.alaCarteValue / b.fillFactor - a.alaCarteValue / a.fillFactor);

  const picks: ComboPick[] = [];
  let cap = remaining;
  let totalValue = 0;
  let totalFill = 0;
  for (const item of ranked) {
    const forcedUnits = forced.get(item.id) ?? 0;
    const headroom = MAX_UNITS_PER_ITEM - forcedUnits;
    if (headroom <= 0) continue;
    const fits = Math.floor(cap / item.fillFactor);
    const take = Math.min(headroom, fits);
    if (take <= 0) continue;
    picks.push({ itemId: item.id, units: take });
    totalValue += take * item.alaCarteValue;
    totalFill += take * item.fillFactor;
    cap -= take * item.fillFactor;
  }
  return { picks, totalValue, totalFill };
}

function mergePicks(a: ComboPick[], b: ComboPick[]): ComboPick[] {
  const map = new Map<ItemId, number>();
  for (const p of a) map.set(p.itemId, (map.get(p.itemId) ?? 0) + p.units);
  for (const p of b) map.set(p.itemId, (map.get(p.itemId) ?? 0) + p.units);
  return Array.from(map, ([itemId, units]) => ({ itemId, units }));
}

function signature(combo: ComboSuggestion): string {
  return [...combo.picks]
    .sort((a, b) =>
      a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0
    )
    .map((p) => `${p.itemId}:${p.units}`)
    .join("|");
}
