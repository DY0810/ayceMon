import { describe, expect, it } from "vitest";

import { formatGrams } from "./format";

describe("formatGrams", () => {
  it("renders integer grams with unit suffix", () => {
    expect(formatGrams(200)).toBe("200g");
  });

  it("rounds fractional grams to the nearest whole gram", () => {
    // The entry-level unit is grams; fractional grams would only appear from
    // derived values (units × gramsPerUnit). We display whole grams so the
    // label stays compact on the tracker card.
    expect(formatGrams(199.6)).toBe("200g");
    expect(formatGrams(199.4)).toBe("199g");
  });

  it("renders zero as '0g' (explicit user-weighed entries may legitimately be 0)", () => {
    expect(formatGrams(0)).toBe("0g");
  });

  it("renders large values without thousands separators", () => {
    // Grams budgets top out at ~2500 (Competitive preset). No need for
    // locale-aware thousands separators — the display is always tabular
    // and short enough to read without them.
    expect(formatGrams(1800)).toBe("1800g");
    expect(formatGrams(2500)).toBe("2500g");
  });
});
