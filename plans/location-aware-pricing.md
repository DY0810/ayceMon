# Plan — Location-Aware Pricing (Cheapest Version)

> **Objective:** Adjust seed-catalog à la carte prices by the user's city tier so a wagyu short rib pre-fills at ~$26 in NYC, ~$22 in a standard metro, ~$20 in the suburbs, and ~$18 rural — without adding a backend, a geo API, or any new deps. Users still pick manually if they want.

> **Mode:** Direct edit (repo is not git-tracked). Follow-up to `plans/robust-price-estimates.md`.

---

## Locked design

**Tier taxonomy:**

```ts
export type CityTier = "metro-premium" | "metro-standard" | "suburban" | "rural";

export const CITY_TIER_MULTIPLIER: Record<CityTier, number> = {
  "metro-premium":  1.20,   // NYC, SF, LA, Boston, Seattle, DC, Honolulu
  "metro-standard": 1.00,   // baseline — most U.S. metros
  "suburban":       0.90,
  "rural":          0.80,
};
```

**Default:** `metro-standard` (neutral, matches today's behavior — so existing persisted sessions load unchanged).

**Rounding:** adjusted values round to the nearest $0.25 to look priced, not raw-multiplied.

**Where the multiplier applies:**
- Displayed `$low–$high` chips in the `ItemSuggest` dropdown (what the user sees before picking).
- The pre-filled `alaCarteValue` when a suggestion is picked.
- The `typical $L–$H` hint next to the value field.
- **Nothing else.** The raw `SEED_CATALOG` stays a pure constant. The multiplier is applied at display/pick time only.

**Not adjusted:**
- Manually-entered values. If you type a value, it's your value.
- Values already in the library. Changing the tier mid-session does NOT retroactively edit existing items — that's a feature, not a bug (you already committed to those prices).

**Where the multiplier comes from:**
- `Session.cityTier?: CityTier` (optional, additive like the other new fields).
- Set at `/setup`. Undefined → treat as `metro-standard` (= 1.00, no-op).
- Not editable mid-session for v1. End session + start a new one to change it.

---

## Anti-patterns

- ❌ No geo API, no IP lookup, no navigator.geolocation. Pure user choice.
- ❌ Don't mutate `SEED_CATALOG` entries — multiplier applies at call sites.
- ❌ Don't make `cityTier` required. Existing persisted sessions must still hydrate.
- ❌ Don't apply the multiplier retroactively to items already in the library.
- ❌ No rounding inside the pure multiplier math — round at the display boundary only.
- ❌ Don't add a city text input with a list of 50 metros. Four tiers is the whole point of "cheapest version."

---

## Step L1 — CityTier Type + Pricing Module

**Files.**
- `lib/types.ts` (edit): add `CityTier` union, extend `Session` with optional `cityTier`.
- `lib/pricing.ts` (new): exports `CITY_TIER_MULTIPLIER`, `tierMultiplier(tier)`, `adjustSeedValue(raw, tier)`, `adjustSeedRange(low, high, tier)`.
- `lib/pricing.test.ts` (new): exhaustive tests — every tier, rounding, undefined tier → 1.0, range endpoints, integer-preservation edge cases.

**API (locked):**

```ts
// lib/pricing.ts
import type { CityTier } from "./types";

export const CITY_TIER_MULTIPLIER: Record<CityTier, number> = {
  "metro-premium":  1.20,
  "metro-standard": 1.00,
  "suburban":       0.90,
  "rural":          0.80,
};

export function tierMultiplier(tier: CityTier | undefined): number {
  return tier === undefined ? 1.0 : CITY_TIER_MULTIPLIER[tier];
}

// Applies the multiplier and rounds to the nearest $0.25 for display.
export function adjustSeedValue(raw: number, tier: CityTier | undefined): number;

// Convenience — adjusts both endpoints with the same rounding.
export function adjustSeedRange(
  low: number,
  high: number,
  tier: CityTier | undefined
): { low: number; high: number };
```

**Tests.**
- `tierMultiplier(undefined) === 1.0`
- `tierMultiplier("metro-premium") === 1.2` etc.
- `adjustSeedValue(22, "metro-premium")` → `26.50` (22 × 1.2 = 26.40 → nearest $0.25 = 26.50)
- `adjustSeedValue(22, undefined)` → `22` (or 22.00)
- `adjustSeedValue(3, "rural")` → `2.50` (3 × 0.8 = 2.4 → 2.50)
- `adjustSeedValue(0, "metro-premium")` → `0`
- `adjustSeedRange(15, 22, "metro-premium")` → `{ low: 18, high: 26.50 }`
- Rounding symmetry: `adjustSeedValue(x, tier)` is non-negative for non-negative `x`.

**Verification.**
- [ ] `npm test -- lib/pricing.test.ts` green.
- [ ] `npm run build` green.
- [ ] No `: any`, `<any[,>]`, `as any`.

**Rollback.** Delete `lib/pricing.ts` + `lib/pricing.test.ts`, revert the `CityTier`/`Session.cityTier` additions in `lib/types.ts`.

---

## Step L2 — City Tier Dropdown in Setup

**Files.**
- `app/setup/page.tsx` (edit): add a native `<select>` under the buffet price input labeled "City tier" with an inline hint explaining each option.
- `lib/store.ts` (edit): extend `startSession` input to accept optional `cityTier`.

**UI.**
- Native `<select>` styled to match the existing inputs (`h-11 text-base`, same border classes). No shadcn `Select` install — follow the same "avoid base-nova registry mismatch" discipline as `ItemSuggest`.
- Options: "Major metro — NYC/SF/LA (+20%)", "Standard city (default)", "Suburban (−10%)", "Rural/small town (−20%)".
- Default selection: `metro-standard`.
- Helper text: "Adjusts suggested à la carte prices for your area. Manual entries are never adjusted."

**Tasks.**
1. Add `cityTier` to the setup form local state (default `"metro-standard"`).
2. Pass `cityTier` to `startSession`.
3. In `lib/store.ts`, extend the `startSession` parameter object and store `cityTier` on the new session.
4. `useAyceStore` consumers outside of setup don't need changes — the field is optional and defaulted at read time via `tierMultiplier(session.cityTier)`.

**Verification.**
- [ ] `npm test` green (no regressions).
- [ ] `npm run build` green.
- [ ] Manual: start a session with each tier, confirm the selection persists across refresh.
- [ ] Existing persisted session without `cityTier` still hydrates and behaves identically (multiplier = 1.0).

**Rollback.** Revert both files.

---

## Step L3 — Apply Multiplier in Suggestion Flow

**Files.**
- `components/item-suggest.tsx` (edit): accept `multiplier` prop, adjust the `$low–$high` chip in each dropdown row.
- `components/item-suggest-helpers.ts` (edit): `applyPick` takes an optional `multiplier` param; when a seed is picked, `alaCarteValue` is adjusted.
- `components/item-suggest-helpers.test.ts` (edit): add cases for `applyPick` with a multiplier.
- `app/library/page.tsx` (edit): read `session.cityTier` → compute multiplier via `tierMultiplier` → pass to `<ItemSuggest multiplier={...} />` and use when setting the `seedRange` hint state.

**Tasks.**
1. `applyPick(suggestion, source, multiplier?)`. If `multiplier` is omitted, defaults to 1.0 (back-compat with the helper's current signature).
2. In `item-suggest.tsx`, the dropdown row's price chip reads `adjustSeedRange(entry.valueLow, entry.valueHigh, tier)` — but we can't pass `tier` to avoid a leaky abstraction. Instead, pass a single `multiplier: number` prop and build a tiny local helper `formatRangeChip(low, high, multiplier)` that applies + rounds the range.
3. Library page reads the tier from the store and passes `tierMultiplier(session.cityTier)` into the component.
4. The `seedRange` state in the library page uses the adjusted low/high so the "typical $L–$H" hint next to the value input matches what the dropdown showed.

**Verification.**
- [ ] `npm test` green.
- [ ] `npm run build` green.
- [ ] Manual: start a session with `metro-premium`, open the Add Item dialog, type "short rib" — the dropdown chip should show `$18–$26` (approximately; exact numbers depend on the seed catalog's Wagyu Short Rib entry). After picking, the value field should contain the adjusted midpoint, not the raw catalog value.
- [ ] Manual: start a `rural` session and confirm the same item pre-fills noticeably lower.
- [ ] Manual: start a `metro-standard` session — behavior identical to pre-change baseline (sanity check that the multiplier of 1.0 is a true no-op).

**Rollback.** Revert the four files.

---

## Step L4 — E2E Extension + Verification

**Files.**
- `e2e/happy-path.spec.ts` (edit): in the setup phase, pick `metro-premium` from the new tier dropdown. Then assert that the pre-filled value after picking a seed suggestion is strictly greater than the raw catalog midpoint (proving the multiplier applied). A simple check: assert `Number(valueFromDialog) > 20` for wagyu short rib (raw ~22, adjusted ~26.50).

**Tasks.**
1. Add a line in the setup step selecting the `metro-premium` option from the tier `<select>`.
2. In `addLibraryItemViaSuggestion`, read the value field after the pick and expose it back to the test body OR tighten the existing assertion (currently `Number(valueText) > 0`). Easier: add a second assertion to the caller that checks the short rib value is > 24 (adjusted) vs. the unadjusted baseline of ~22.
3. Run full verification:
   - `npm test`
   - `npx playwright test`
   - `npm run build`
   - Grep gates (`: any\b`, `<any[,>]`, `as any`, `TODO|FIXME`, `console\.log`).
4. Append a "Done" block to this plan file.

**Verification (final).**
- [ ] Unit tests green.
- [ ] E2E green.
- [ ] Build clean.
- [ ] Grep gates zero.
- [ ] Manual smoke: walk through setup → library → add via suggestion, for each tier, verify adjusted values are visibly different.

---

## Out of scope

- City text input / metro lookup table (that's the "middle version" — follow-up plan).
- Currency conversion.
- Per-cuisine or per-item multipliers (e.g., sushi is more expensive in coastal metros relative to steak) — too granular for v1.
- Retroactively adjusting items already in the library when tier changes.
- Automatic geo detection (explicitly a non-goal per the objective).

---

## Done

Completed 2026-04-08.

- Tiers shipped: yes — `metro-premium` (1.2×), `metro-standard` (1.0×, default), `suburban` (0.9×), `rural` (0.8×).
- `npx vitest run` final count: **72/72 passing** across 5 test files (up from 53 before Step L1 — added `lib/pricing.test.ts` with 15 tier/rounding tests and extended `components/item-suggest-helpers.test.ts` by 4 tier cases).
- `npx playwright test`: **1/1 passing** (`e2e/happy-path.spec.ts`). Test now selects `metro-premium` at setup, uses the suggestion helper to pick "wagyu short rib", and asserts the pre-filled value is `> $24` (proves the 1.2× multiplier applied — raw $22 → $26.50).
- `npm run build`: **pass** (Next.js 16.2.2 Turbopack, TypeScript clean, 7 static routes generated).
- Grep gates clean: no `: any`, no `<any,`/`<any>`, no `as any`, no `TODO|FIXME`, no `console.log` in `**/*.{ts,tsx}`.
- Files touched: `lib/types.ts`, `lib/pricing.ts` (new), `lib/pricing.test.ts` (new), `lib/store.ts`, `app/setup/page.tsx`, `app/library/page.tsx`, `components/item-suggest.tsx`, `components/item-suggest-helpers.ts`, `components/item-suggest-helpers.test.ts`, `e2e/happy-path.spec.ts`.
- Additive-only to `Session.cityTier?` → no Zustand persist migration needed; pre-existing localStorage sessions still hydrate with `undefined` tier (treated as baseline 1.0×).
- Manual override preserved: users can always type the value field by hand; editing the value after a pick clears the `typical $low–$high` hint.
