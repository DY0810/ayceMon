import type { PriceSource, CityTier } from "../lib/types";
import type { SeedEntry } from "../lib/seed-catalog";
import { adjustSeedValue } from "../lib/pricing";

export type SuggestionEntry =
  | { kind: "seed"; entry: SeedEntry }
  | {
      kind: "estimate";
      name: string;
      estimate: number;
      low: number;
      high: number;
    };

export interface PickedState {
  name: string;
  alaCarteValue: string;
  fillFactor: number;
  // Phase 2 (collab-and-quantitative-appetite): grams-per-unit carried
  // through from the seed so the library dialog can pre-fill it. Undefined
  // for estimate suggestions (the LLM path does not produce a mass yet).
  gramsPerUnit: number | undefined;
  category: string;
  sourceKind: PriceSource;
  sourceRef: string | undefined;
  pickedRefName: string | undefined;
}

// Given a SuggestionEntry + source, compute the next form state patch.
// Pure — no DOM, no store access. Tested in item-suggest-helpers.test.ts.
//
// `tier` is the current session's CityTier (undefined → baseline 1.0).
// When a seed is picked, its `typicalValue` is adjusted by the tier
// multiplier and rounded to the nearest $0.25 for display. Estimate
// suggestions are not adjusted — the LLM (if ever wired up) is already
// city-aware.
export function applyPick(
  suggestion: SuggestionEntry,
  source: PriceSource,
  tier?: CityTier
): PickedState {
  if (suggestion.kind === "seed") {
    const { entry } = suggestion;
    const adjusted = adjustSeedValue(entry.typicalValue, tier);
    return {
      name: entry.name,
      alaCarteValue: String(adjusted),
      fillFactor: entry.fillFactor,
      gramsPerUnit: entry.gramsPerUnit,
      category: entry.category ?? "",
      sourceKind: source,
      sourceRef: entry.id,
      pickedRefName: entry.name,
    };
  }
  return {
    name: suggestion.name,
    alaCarteValue: String(suggestion.estimate),
    fillFactor: 5,
    gramsPerUnit: undefined,
    category: "",
    sourceKind: source,
    sourceRef: `estimate.${suggestion.name.toLowerCase()}`,
    pickedRefName: suggestion.name,
  };
}

// Invalidation rule: if the user edits the name field after a pick,
// the item is no longer the picked entity and becomes "user"-sourced.
// Called from the name input's onChange handler.
export function computeSource(
  pickedRefName: string | undefined,
  currentName: string
): { sourceKind: PriceSource; clearRef: boolean } {
  if (pickedRefName === undefined) {
    return { sourceKind: "user", clearRef: false };
  }
  if (currentName.trim() === pickedRefName.trim()) {
    return { sourceKind: "seed", clearRef: false };
  }
  return { sourceKind: "user", clearRef: true };
}
