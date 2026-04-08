import { describe, expect, it } from "vitest";

import { suggestCombo, suggestTopN } from "./optimizer";
import type { Item, Session } from "./types";

function makeItem(
  id: string,
  name: string,
  alaCarteValue: number,
  fillFactor: number
): Item {
  return { id, name, alaCarteValue, fillFactor };
}

function makeSession(
  appetiteBudget: number,
  library: Item[]
): Session {
  return {
    id: "test-session",
    buffetPrice: 0,
    appetiteBudget,
    library,
    eaten: [],
    startedAt: 0,
  };
}

describe("suggestCombo", () => {
  it("returns an empty combo when the library is empty", () => {
    const result = suggestCombo(makeSession(20, []));
    expect(result).toEqual({ picks: [], totalValue: 0, totalFill: 0 });
  });

  it("returns an empty combo when capacity is zero", () => {
    const session = makeSession(0, [makeItem("a", "Steak", 20, 5)]);
    const result = suggestCombo(session);
    expect(result).toEqual({ picks: [], totalValue: 0, totalFill: 0 });
  });

  it("picks the only item when there is just one", () => {
    const session = makeSession(15, [makeItem("a", "Steak", 20, 5)]);
    const result = suggestCombo(session);
    // 15 / 5 = 3 steaks fit; bound (10) doesn't bind here.
    expect(result.picks).toEqual([{ itemId: "a", units: 3 }]);
    expect(result.totalValue).toBe(60);
    expect(result.totalFill).toBe(15);
  });

  it("picks zero units when no item fits the capacity", () => {
    const session = makeSession(3, [makeItem("a", "Steak", 20, 5)]);
    const result = suggestCombo(session);
    expect(result.picks).toEqual([]);
    expect(result.totalValue).toBe(0);
    expect(result.totalFill).toBe(0);
  });

  it("picks exactly one item when capacity equals its weight", () => {
    const session = makeSession(5, [makeItem("a", "Steak", 20, 5)]);
    const result = suggestCombo(session);
    expect(result.picks).toEqual([{ itemId: "a", units: 1 }]);
    expect(result.totalValue).toBe(20);
    expect(result.totalFill).toBe(5);
  });

  it("prefers the higher-value item when one dominates", () => {
    // Spec example: budget 10. Two steaks ($40, fill 10) beats five salads ($15, fill 10).
    const session = makeSession(10, [
      makeItem("steak", "Steak", 20, 5),
      makeItem("salad", "Salad", 3, 2),
    ]);
    const result = suggestCombo(session);
    expect(result.picks).toEqual([{ itemId: "steak", units: 2 }]);
    expect(result.totalValue).toBe(40);
    expect(result.totalFill).toBe(10);
  });

  it("respects the 10-unit per-item cap", () => {
    // Capacity 100, fill 1 each: unbounded would pick 100 of one item.
    // The cap clamps to 10 of the best item, then fills the rest with the next best.
    const session = makeSession(100, [
      makeItem("rib", "Short rib", 18, 1),
      makeItem("fries", "Fries", 5, 1),
    ]);
    const result = suggestCombo(session);
    const ribs = result.picks.find((p) => p.itemId === "rib");
    const fries = result.picks.find((p) => p.itemId === "fries");
    expect(ribs?.units).toBe(10);
    expect(fries?.units).toBe(10);
    // 10 ribs + 10 fries = 20 fill; remaining 80 capacity has no items left under the cap.
    expect(result.totalFill).toBe(20);
    expect(result.totalValue).toBe(10 * 18 + 10 * 5);
  });

  it("mixes items when the budget allows it", () => {
    // Budget 11. Steak fill 5 / $20, salad fill 1 / $3.
    // Best: 2 steaks (fill 10, value 40) + 1 salad (fill 1, value 3) = 43.
    const session = makeSession(11, [
      makeItem("steak", "Steak", 20, 5),
      makeItem("salad", "Salad", 3, 1),
    ]);
    const result = suggestCombo(session);
    expect(result.totalValue).toBe(43);
    expect(result.totalFill).toBe(11);
    const steak = result.picks.find((p) => p.itemId === "steak");
    const salad = result.picks.find((p) => p.itemId === "salad");
    expect(steak?.units).toBe(2);
    expect(salad?.units).toBe(1);
  });
});

describe("suggestTopN", () => {
  it("returns an empty list when n is zero", () => {
    const session = makeSession(10, [makeItem("a", "Steak", 20, 5)]);
    expect(suggestTopN(session, 0)).toEqual([]);
  });

  it("returns at most n combos", () => {
    const session = makeSession(20, [
      makeItem("a", "Short rib", 18, 5),
      makeItem("b", "Brisket", 12, 4),
      makeItem("c", "Salad", 3, 1),
      makeItem("d", "Sushi", 9, 3),
    ]);
    const combos = suggestTopN(session, 3);
    expect(combos.length).toBeGreaterThan(0);
    expect(combos.length).toBeLessThanOrEqual(3);
  });

  it("places the unconstrained optimum first", () => {
    const session = makeSession(20, [
      makeItem("a", "Short rib", 18, 5),
      makeItem("b", "Brisket", 12, 4),
      makeItem("c", "Salad", 3, 1),
    ]);
    const combos = suggestTopN(session, 3);
    const baseline = suggestCombo(session);
    expect(combos[0].totalValue).toBe(baseline.totalValue);
  });

  it("returns distinct combos when diverse anchors exist", () => {
    const session = makeSession(20, [
      makeItem("a", "Short rib", 18, 5),
      makeItem("b", "Brisket", 12, 4),
      makeItem("c", "Salad", 3, 1),
      makeItem("d", "Sushi", 9, 3),
    ]);
    const combos = suggestTopN(session, 3);
    const sigs = new Set(
      combos.map((c) =>
        [...c.picks]
          .sort((x, y) => x.itemId.localeCompare(y.itemId))
          .map((p) => `${p.itemId}:${p.units}`)
          .join("|")
      )
    );
    expect(sigs.size).toBe(combos.length);
  });
});
