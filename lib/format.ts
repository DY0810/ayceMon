// Grams formatter shared between the tracker and result pages.
//
// Plan task 4 nudged us to keep this inline and only extract on a third
// site. We extract at two sites because Phase 3's TDD contract calls for a
// vitest test on this helper — moving it to its own module is the smallest
// change that makes it importable without duplicating the spec in two
// places. If a third site ever needs a different rounding rule, fork then.
export function formatGrams(grams: number): string {
  return `${Math.round(grams)}g`;
}
