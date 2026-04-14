import { describe, expect, it } from "vitest";

import { computeFullness, computeTotals, didYouWin, margin, totalEatenValue } from "./calc";
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

describe("computeFullness", () => {
  // Grams-based fullness (plans/collab-and-quantitative-appetite.md, Phase 1).
  // Three branches to cover per the plan:
  //   1. EatenEntry.grams is set → it wins (units × gramsPerUnit ignored).
  //   2. EatenEntry.grams missing but item.gramsPerUnit set → units × gPU.
  //   3. Neither set → that entry contributes 0 (no throw, no NaN).
  const sushi: Item = { id: "a", name: "Nigiri", alaCarteValue: 4, fillFactor: 1, gramsPerUnit: 20 };
  const fries: Item = { id: "b", name: "Fries", alaCarteValue: 5, fillFactor: 2 }; // no gramsPerUnit

  it("uses entry.grams when present (direct override beats units × gramsPerUnit)", () => {
    // Even though units × gramsPerUnit = 2 × 20 = 40g, grams override = 300g wins.
    const library: Item[] = [sushi];
    const eaten: EatenEntry[] = [{ itemId: "a", units: 2, grams: 300 }];
    const result = computeFullness(library, eaten, 1200);
    expect(result.grams).toBe(300);
    expect(result.percent).toBeCloseTo(25, 10);
  });

  it("multiplies units × gramsPerUnit when grams override is absent", () => {
    const library: Item[] = [sushi];
    const eaten: EatenEntry[] = [{ itemId: "a", units: 3 }]; // 3 × 20g = 60g
    const result = computeFullness(library, eaten, 1200);
    expect(result.grams).toBe(60);
    expect(result.percent).toBeCloseTo(5, 10);
  });

  it("contributes 0 when neither grams nor gramsPerUnit are defined", () => {
    const library: Item[] = [fries];
    const eaten: EatenEntry[] = [{ itemId: "b", units: 4 }];
    const result = computeFullness(library, eaten, 1200);
    expect(result.grams).toBe(0);
    expect(result.percent).toBe(0);
  });

  it("honours entry.grams === 0 as an explicit override (not treated as falsy)", () => {
    // Anchors that the override branch uses `Number.isFinite`, not a
    // truthiness check — a user who logs a weighed food as exactly 0g
    // must bypass the units × gramsPerUnit fallback, not fall through
    // to it.
    const library: Item[] = [sushi];
    const eaten: EatenEntry[] = [{ itemId: "a", units: 5, grams: 0 }];
    const result = computeFullness(library, eaten, 1200);
    expect(result.grams).toBe(0);
    expect(result.percent).toBe(0);
  });

  it("sums mixed entries (override + derived + missing) and floors entries without data", () => {
    const library: Item[] = [sushi, fries];
    const eaten: EatenEntry[] = [
      { itemId: "a", units: 2, grams: 100 }, // override → 100g
      { itemId: "a", units: 3 },             // derived → 3 × 20 = 60g
      { itemId: "b", units: 2 },             // nothing → 0g
    ];
    const result = computeFullness(library, eaten, 1200);
    expect(result.grams).toBe(160);
    expect(result.percent).toBeCloseTo((160 / 1200) * 100, 10);
  });

  it("returns percent = 0 when the budget is null (user opted out)", () => {
    // "Skip, I'll eyeball it" → budget = null. Grams still accumulate for
    // display, but percent is 0 so the progress UI shows no ring.
    const library: Item[] = [sushi];
    const eaten: EatenEntry[] = [{ itemId: "a", units: 2 }]; // 40g
    const result = computeFullness(library, eaten, null);
    expect(result.grams).toBe(40);
    expect(result.percent).toBe(0);
  });

  it("allows percent to exceed 100 when the user goes over budget", () => {
    // Phase 1 anti-pattern guard (Appendix B #13): the grams budget is a
    // target, not a hard cap. Don't clamp — UI renders "100%+" itself.
    const library: Item[] = [sushi];
    const eaten: EatenEntry[] = [{ itemId: "a", units: 1, grams: 1500 }];
    const result = computeFullness(library, eaten, 1200);
    expect(result.grams).toBe(1500);
    expect(result.percent).toBeCloseTo(125, 10);
  });

  it("ignores dangling entries whose item has been removed from the library", () => {
    const library: Item[] = [sushi];
    const eaten: EatenEntry[] = [
      { itemId: "a", units: 1 }, // 20g
      { itemId: "ghost", units: 10 }, // item gone → 0g
    ];
    const result = computeFullness(library, eaten, 1200);
    expect(result.grams).toBe(20);
  });
});
