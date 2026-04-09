import { describe, expect, it } from "vitest";

import {
  CITY_TIER_MULTIPLIER,
  adjustSeedRange,
  adjustSeedValue,
  tierMultiplier,
} from "./pricing";
import type { CityTier } from "./types";

describe("tierMultiplier", () => {
  it("returns 1.0 for undefined (implicit default)", () => {
    expect(tierMultiplier(undefined)).toBe(1.0);
  });

  it("returns each tier's published multiplier", () => {
    expect(tierMultiplier("metro-premium")).toBe(1.2);
    expect(tierMultiplier("metro-standard")).toBe(1.0);
    expect(tierMultiplier("suburban")).toBe(0.9);
    expect(tierMultiplier("rural")).toBe(0.8);
  });

  it("matches CITY_TIER_MULTIPLIER for every tier", () => {
    const tiers: CityTier[] = [
      "metro-premium",
      "metro-standard",
      "suburban",
      "rural",
    ];
    for (const tier of tiers) {
      expect(tierMultiplier(tier)).toBe(CITY_TIER_MULTIPLIER[tier]);
    }
  });
});

describe("adjustSeedValue", () => {
  it("is a no-op at the baseline tier", () => {
    expect(adjustSeedValue(22, "metro-standard")).toBe(22);
  });

  it("is a no-op when tier is undefined", () => {
    expect(adjustSeedValue(22, undefined)).toBe(22);
  });

  it("multiplies up for metro-premium and rounds to the nearest $0.25", () => {
    // 22 × 1.2 = 26.40 → nearest $0.25 = 26.50
    expect(adjustSeedValue(22, "metro-premium")).toBe(26.5);
  });

  it("multiplies down for rural and rounds to the nearest $0.25", () => {
    // 3 × 0.8 = 2.40 → nearest $0.25 = 2.50
    expect(adjustSeedValue(3, "rural")).toBe(2.5);
  });

  it("handles suburban rounding", () => {
    // 18 × 0.9 = 16.20 → nearest $0.25 = 16.25
    expect(adjustSeedValue(18, "suburban")).toBe(16.25);
  });

  it("clamps non-positive values to 0", () => {
    expect(adjustSeedValue(0, "metro-premium")).toBe(0);
    expect(adjustSeedValue(-5, "metro-premium")).toBe(0);
  });

  it("produces non-negative output for non-negative input across tiers", () => {
    const tiers: (CityTier | undefined)[] = [
      undefined,
      "metro-premium",
      "metro-standard",
      "suburban",
      "rural",
    ];
    for (const tier of tiers) {
      for (const raw of [0, 1, 3, 8.5, 22, 100]) {
        expect(adjustSeedValue(raw, tier)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("preserves whole-dollar seed values when multiplier is 1.0", () => {
    for (const raw of [1, 5, 12, 22, 100]) {
      expect(adjustSeedValue(raw, "metro-standard")).toBe(raw);
    }
  });
});

describe("adjustSeedRange", () => {
  it("adjusts both endpoints with the same multiplier", () => {
    expect(adjustSeedRange(15, 22, "metro-premium")).toEqual({
      low: 18,
      high: 26.5,
    });
  });

  it("is a no-op at the baseline tier", () => {
    expect(adjustSeedRange(15, 22, "metro-standard")).toEqual({
      low: 15,
      high: 22,
    });
  });

  it("is a no-op when tier is undefined", () => {
    expect(adjustSeedRange(15, 22, undefined)).toEqual({ low: 15, high: 22 });
  });

  it("keeps low <= high after adjustment", () => {
    const tiers: (CityTier | undefined)[] = [
      undefined,
      "metro-premium",
      "metro-standard",
      "suburban",
      "rural",
    ];
    for (const tier of tiers) {
      const { low, high } = adjustSeedRange(15, 22, tier);
      expect(low).toBeLessThanOrEqual(high);
    }
  });
});
