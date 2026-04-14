import { describe, expect, it } from "vitest";

import { computeTotals, didYouWin, margin, totalEatenValue } from "./calc";
import type { EatenEntry, Item, Session } from "./types";

function makeItem(
  id: string,
  name: string,
  alaCarteValue: number,
  fillFactor: number
): Item {
  return { id, name, alaCarteValue, fillFactor };
}

function makeSession(
  buffetPrice: number,
  library: Item[],
  eaten: EatenEntry[]
): Session {
  return {
    id: "test-session",
    buffetPrice,
    appetiteBudget: 30,
    library,
    eaten,
    startedAt: 0,
  };
}

describe("totalEatenValue", () => {
  it("returns 0 when nothing has been eaten", () => {
    const session = makeSession(
      35,
      [makeItem("a", "Short rib", 18, 5)],
      []
    );
    expect(totalEatenValue(session)).toBe(0);
  });

  it("sums a single whole-unit entry", () => {
    const session = makeSession(
      35,
      [makeItem("a", "Short rib", 18, 5)],
      [{ itemId: "a", units: 2 }]
    );
    expect(totalEatenValue(session)).toBe(36);
  });

  it("multiplies fractional units correctly", () => {
    // 0.5 × $18 = $9
    const session = makeSession(
      35,
      [makeItem("a", "Salmon roll", 18, 3)],
      [{ itemId: "a", units: 0.5 }]
    );
    expect(totalEatenValue(session)).toBe(9);
  });

  it("sums multiple distinct items including fractional units", () => {
    const session = makeSession(
      35,
      [
        makeItem("a", "Short rib", 18, 5),
        makeItem("b", "Salad", 3, 1),
        makeItem("c", "Dessert", 7, 2),
      ],
      [
        { itemId: "a", units: 1.5 }, // 27
        { itemId: "b", units: 2 }, // 6
        { itemId: "c", units: 0.5 }, // 3.5
      ]
    );
    expect(totalEatenValue(session)).toBeCloseTo(36.5, 10);
  });

  it("skips entries whose itemId no longer exists in the library and does not throw", () => {
    // "ghost" was in the library earlier but has since been removed;
    // its units should contribute 0 and the function must not crash.
    const session = makeSession(
      35,
      [makeItem("a", "Short rib", 18, 5)],
      [
        { itemId: "a", units: 1 },
        { itemId: "ghost", units: 99 },
      ]
    );
    expect(() => totalEatenValue(session)).not.toThrow();
    expect(totalEatenValue(session)).toBe(18);
  });

  it("returns 0 when every eaten entry is dangling", () => {
    const session = makeSession(
      35,
      [makeItem("a", "Short rib", 18, 5)],
      [{ itemId: "ghost", units: 4 }]
    );
    expect(totalEatenValue(session)).toBe(0);
  });
});

describe("margin", () => {
  it("is -buffetPrice when nothing has been eaten", () => {
    const session = makeSession(
      35,
      [makeItem("a", "Short rib", 18, 5)],
      []
    );
    expect(margin(session)).toBe(-35);
  });

  it("is 0 when eaten value exactly equals buffet price", () => {
    // 2 × $17.50 = $35 exactly
    const session = makeSession(
      35,
      [makeItem("a", "Short rib", 17.5, 5)],
      [{ itemId: "a", units: 2 }]
    );
    expect(margin(session)).toBe(0);
  });

  it("is positive when eaten value exceeds buffet price", () => {
    // 3 × $18 = $54, buffet $35, margin = $19
    const session = makeSession(
      35,
      [makeItem("a", "Short rib", 18, 5)],
      [{ itemId: "a", units: 3 }]
    );
    expect(margin(session)).toBe(19);
  });

  it("is negative when eaten value is below buffet price", () => {
    // 0.5 × $18 = $9, buffet $35, margin = -$26
    const session = makeSession(
      35,
      [makeItem("a", "Short rib", 18, 5)],
      [{ itemId: "a", units: 0.5 }]
    );
    expect(margin(session)).toBe(-26);
  });

  it("ignores dangling eaten entries when computing margin", () => {
    const session = makeSession(
      35,
      [makeItem("a", "Short rib", 18, 5)],
      [
        { itemId: "a", units: 1 },
        { itemId: "ghost", units: 50 },
      ]
    );
    expect(() => margin(session)).not.toThrow();
    expect(margin(session)).toBe(18 - 35);
  });
});

describe("didYouWin", () => {
  it("returns false when nothing has been eaten", () => {
    const session = makeSession(
      35,
      [makeItem("a", "Short rib", 18, 5)],
      []
    );
    expect(didYouWin(session)).toBe(false);
  });

  it("returns true when eaten value exactly equals buffet price (>=, not >)", () => {
    const session = makeSession(
      35,
      [makeItem("a", "Short rib", 17.5, 5)],
      [{ itemId: "a", units: 2 }]
    );
    expect(didYouWin(session)).toBe(true);
  });

  it("returns true when eaten value exceeds buffet price", () => {
    const session = makeSession(
      35,
      [makeItem("a", "Short rib", 18, 5)],
      [{ itemId: "a", units: 2 }] // $36
    );
    expect(didYouWin(session)).toBe(true);
  });

  it("returns false when eaten value is just below buffet price", () => {
    const session = makeSession(
      35,
      [makeItem("a", "Short rib", 18, 5)],
      [{ itemId: "a", units: 1.9 }] // $34.20
    );
    expect(didYouWin(session)).toBe(false);
  });

  it("does not crash and returns false for a dangling-only eaten list", () => {
    const session = makeSession(
      35,
      [makeItem("a", "Short rib", 18, 5)],
      [{ itemId: "ghost", units: 99 }]
    );
    expect(() => didYouWin(session)).not.toThrow();
    expect(didYouWin(session)).toBe(false);
  });
});

describe("computeTotals (SessionRecord-shaped inputs)", () => {
  it("produces correct totals from a finished session's library/eaten snapshot", () => {
    // Simulates a SessionRecord snapshot: library and eaten are plain arrays,
    // not wrapped in a Session object. This proves the server action path
    // (Phase 3) can feed computeTotals directly.
    const library: Item[] = [
      makeItem("a", "Wagyu Short Rib", 22, 7),
      makeItem("b", "Salmon Sashimi", 14, 3),
      makeItem("c", "Edamame", 4, 1),
    ];
    const eaten: EatenEntry[] = [
      { itemId: "a", units: 2 },   // 44
      { itemId: "b", units: 1.5 }, // 21
      { itemId: "c", units: 1 },   // 4
    ];
    const buffetPrice = 35;

    const result = computeTotals(library, eaten, buffetPrice);

    expect(result.total).toBeCloseTo(69, 10);
    expect(result.margin).toBeCloseTo(34, 10);
    expect(result.won).toBe(true);
  });
});
