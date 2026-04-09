import type { CityTier } from "./types";

// City tier → price multiplier. The baseline is "metro-standard" at 1.0 —
// it's also the implicit default when a session has no cityTier recorded
// (e.g., sessions persisted before this feature shipped).
export const CITY_TIER_MULTIPLIER: Readonly<Record<CityTier, number>> = {
  "metro-premium": 1.2,
  "metro-standard": 1.0,
  suburban: 0.9,
  rural: 0.8,
};

// Pure lookup. Undefined tier is treated as the neutral baseline so
// existing persisted sessions load with identical behavior.
export function tierMultiplier(tier: CityTier | undefined): number {
  if (tier === undefined) return 1.0;
  return CITY_TIER_MULTIPLIER[tier];
}

// Round to the nearest $0.25. Display-only helper — the raw multiplier
// math is exact, and we round only at the boundary so chained operations
// don't accumulate rounding error.
function roundToQuarter(value: number): number {
  return Math.round(value * 4) / 4;
}

// Applies the tier multiplier and rounds to the nearest $0.25 for display.
// Non-negative in, non-negative out.
export function adjustSeedValue(
  raw: number,
  tier: CityTier | undefined
): number {
  if (raw <= 0) return 0;
  return roundToQuarter(raw * tierMultiplier(tier));
}

// Adjusts both endpoints of a seed-catalog price range.
export function adjustSeedRange(
  low: number,
  high: number,
  tier: CityTier | undefined
): { low: number; high: number } {
  return {
    low: adjustSeedValue(low, tier),
    high: adjustSeedValue(high, tier),
  };
}
