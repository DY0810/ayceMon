import type { PriceSource } from "@/lib/types";
import type { SeedEntry } from "@/lib/seed-catalog";

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
  category: string;
  sourceKind: PriceSource;
  sourceRef: string | undefined;
  pickedRefName: string | undefined;
}

// Given a SuggestionEntry + source, compute the next form state patch.
// Pure — no DOM, no store access. Tested in item-suggest-helpers.test.ts.
export function applyPick(
  suggestion: SuggestionEntry,
  source: PriceSource
): PickedState {
  if (suggestion.kind === "seed") {
    const { entry } = suggestion;
    return {
      name: entry.name,
      alaCarteValue: String(entry.typicalValue),
      fillFactor: entry.fillFactor,
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
