# Plan — Robust Per-Item Price Estimates

> **Objective:** Make the à la carte dollar value on each buffet item less dependent on the user typing a number from memory. Primary mechanism: ship a curated **seed catalog** of common AYCE items bundled with the app, with an autocomplete/suggestion UI in the Add Item dialog that pre-fills `alaCarteValue`, `fillFactor`, and `category`. The user can always override. Optional stretch: an LLM-backed fallback for cache-misses, feature-gated and fully optional.

> **Mode:** **Direct mode** — `/Users/dyl/ayceMon` is not a git repository (`git status` → "fatal: not a git repository"), so steps edit files in place. No branches, no PRs, no CI. Each step is a logical unit; verification commands are run locally before moving on.

---

## Background — Why a bundled seed catalog (read once, before starting)

The obvious impulse is "use an open food price API." I researched the options in depth; here's the short version so future-you doesn't re-litigate it:

| Source | Verdict | Why |
|---|---|---|
| **Open Food Facts / Open Prices** (prices.openfoodfacts.org) | ❌ Wrong domain | Crowdsourced **grocery/retail** receipts keyed to barcodes. Structurally excludes dim sum, sushi pieces, KBBQ cuts. |
| **USDA FoodData Central** | ❌ No prices | FDC is nutrition-only. |
| **USDA QFAFHP** (Quarterly Food-Away-From-Home Prices) | ❌ Dead + too coarse | Discontinued 2012; aggregate category only (e.g., "full-service entrees"), no dish detail. |
| **BLS Average Retail Food Prices API** | ❌ Grocery only | ~70 items, per-pound retail (ground beef, rice, etc.). Zero restaurant dishes. |
| **Nutritionix** | ❌ No prices | Nutrition-focused; price isn't a first-class field. |
| **Spoonacular** | ❌ Wrong coverage + license | ~100k chain menu items (Olive Garden, Panda Express) with price field, but license forbids caching the catalog and coverage explicitly misses independent KBBQ/sushi/dim sum — the AYCE use case. Free tier is token-limited. |
| **Edamam** | ❌ No prices | Recipe/nutrition. |
| **Claude Haiku 4.5 estimation** | ✅ Only viable *external* option | ~$0.00045/call (200in+50out @ $1/$5 per Mtok). Strong priors on sushi/KBBQ/dim sum cuts. Requires a Next.js route handler to hide the API key + client-side cache. |
| **Hand-curated seed catalog** | ✅ **Best primary** | The universe is small: 300–500 canonical items across 6–8 cuisines cover ~90% of realistic AYCE use. Bundled JSON = zero latency, zero cost, offline, versionable. |

**Decision:** Primary = bundled seed catalog. Stretch = LLM fallback (optional, env-gated). Manual override is always the final word.

---

## Domain Model Addendum (plan mutation vs PLAN.md)

`PLAN.md` has an anti-pattern guard: "Don't invent additional fields on `Item` or `Session` beyond the model above without updating this plan." This plan adds two **optional** fields to `Item`:

```ts
// lib/types.ts — additions only
export type PriceSource = "user" | "seed" | "estimate";

export interface Item {
  id: ItemId;
  name: string;
  alaCarteValue: number;
  fillFactor: number;
  category?: string;
  // NEW (both optional — existing persisted items remain valid):
  sourceKind?: PriceSource;     // default behavior: treat undefined as "user"
  sourceRef?: string;           // seed entry id, or LLM request hash
}
```

**Migration:** No schema migration. Existing `localStorage` sessions load unchanged; `sourceKind === undefined` is interpreted as `"user"` wherever it matters.

**Record in PLAN.md:** Step 2 below appends a one-line note under the Domain Model block pointing to this plan file. Do **not** rewrite the PLAN.md model verbatim.

---

## Global anti-patterns (every step)

- ❌ No backend database for prices. The seed catalog is a static bundled module — not "a backend."
- ❌ No third-party commercial price API (Spoonacular, Nutritionix, Edamam). License + coverage are wrong.
- ❌ No `any` in TypeScript.
- ❌ No heavy deps. Do **not** pull in `fuse.js`, `flexsearch`, `lunr`, etc. The seed catalog is small; normalized substring + token-prefix match is sufficient.
- ❌ Don't leak an Anthropic API key to the client. The LLM fallback (Step 5) **must** go through a server route handler.
- ❌ Don't remove the manual input. The value field is always editable regardless of source.
- ❌ Don't make `sourceKind` a required field. Breaks existing persisted state.
- ❌ Don't rename existing `alaCarteValue` — the field stays.
- ❌ Don't introduce per-keystroke LLM calls. Debounce, cache, and only fire on "no seed match" after the user has stopped typing.

---

## Step dependency graph

```
     Step 0 (research/API verification)
          │
          ├──► Step 1 (seed catalog data + helpers)  ─┐
          │                                            ├──► Step 3 (suggestion UI) ──► Step 4 (badges) ──► Step 6 (E2E + verification)
          └──► Step 2 (type + store extension)       ─┘                         │
                                                                                 └──► Step 5 (optional LLM fallback, feature-gated) ──► Step 6
```

**Parallelizable:** Step 1 and Step 2 (no shared files). Everything else is serial.

**Model tier:** Step 1 benefits from the strongest model (broad curation + accurate typical price ranges across cuisines). Step 5 also benefits from the strongest model for prompt/schema design. Others use the default tier.

---

## Step 0 — Research & API Verification

**Context brief (cold-start).**
`ayceMon` is a Next.js App Router + Tailwind v4 + Zustand-persisted (localStorage) buffet-value tracker. Users type items into a library; each item has a manual à la carte dollar value. Goal of this plan: pre-fill that value from a bundled catalog. `AGENTS.md` says: "This is NOT the Next.js you know. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code." Respect that here. The project is **not** a git repo.

**Tasks.**
1. Read `node_modules/next/dist/docs/` (or equivalent) for the **current** Route Handler pattern (used only in Step 5 — but decide the API shape now). Record the exact export signature for `POST` and how to read the JSON body.
2. Confirm the shadcn component pattern for a combobox / autocomplete in **this codebase**. The installed components are only `badge, button, card, dialog, input, progress, slider` (verified in `components/ui/`). There is no `Command` component yet. **Important:** `components.json` sets `"style": "base-nova"` — a **non-default** shadcn style. Before running any `shadcn add` command, verify that `command` and `popover` components exist in the `base-nova` registry by checking `components.json` and, if needed, running `npx shadcn@latest add --help` or inspecting the registry. If `base-nova` does not ship those components, prefer the **handrolled dropdown** approach (option b) to avoid a style mismatch. Options:
   - (a) `npx shadcn@latest add command popover` if (and only if) `base-nova` supports them.
   - (b) Handrolled: a positioned `<ul role="listbox">` beneath the existing `Input`, with `aria-activedescendant`, keyboard nav, and outside-click close.
   Record the chosen approach and the exact command (if any) in the Decisions block.
3. Check the Zustand `persist` migration story: if we ever need to migrate localStorage shape, what's the current `migrate` / `version` API? Document the import path and signature. (Not used this plan, but record for future safety.)
4. If Step 5 will be attempted, confirm the Anthropic SDK package name (`@anthropic-ai/sdk`) and the current `messages.create` signature for Claude Haiku 4.5 (`claude-haiku-4-5-20251001`). Record the minimal request body.
5. Seed catalog format is **already decided**: TS module at `lib/seed-catalog.ts` (locked in Step 1). Step 0 does not re-open this; just echo the decision into the block for cold-start clarity.

**Deliverable.** Insert a "Decisions & Allowed APIs" block into this plan file at an exact location: immediately after the **Global anti-patterns** section and immediately before the **Step dependency graph** heading. In-place edit to this file.

```
# Decisions & Allowed APIs (Step 0 output)
- Route Handler export pattern:       <exact code snippet>
- Combobox approach:                  <shadcn add command popover | handrolled>
- Zustand persist migrate signature:  <import path + signature>
- Anthropic SDK import:                <package@version + minimal call>
- Seed catalog format:                 lib/seed-catalog.ts (TS module)
```

**Verification.**
- [ ] Every line above has a concrete source (file path or URL actually read, not assumed).
- [ ] No guessed flags, imports, or signatures.

**Exit criteria.** The Decisions block is populated and committed into this plan file. No code has been written yet.

---

## Step 1 — Seed Catalog Data + Match Helpers

**Context brief (cold-start).**
You are creating the primary data source for pre-filled prices. It's a static TypeScript module — no backend, no fetch, no network. The app already has `lib/types.ts`, `lib/calc.ts`, and `lib/optimizer.ts`; this file sits next to them. The catalog needs to be broad enough to cover the realistic AYCE cuisines that matter: **KBBQ, sushi, Chinese buffet, dim sum, hot pot, Brazilian steakhouse / churrasco, Indian buffet, pizza, seafood buffet, dessert**. Realistic target: 200–350 entries. You are NOT building a global restaurant menu DB — you're capturing the ~90% of common items users will type.

**Model tier recommendation:** Strongest available model. Accurate typical price ranges matter; hallucinated values undermine the feature.

**Tasks.**
1. Create `lib/seed-catalog.ts` exporting:
   ```ts
   export type Cuisine =
     | "kbbq" | "sushi" | "chinese" | "dimsum" | "hotpot"
     | "brazilian" | "indian" | "pizza" | "seafood" | "dessert"
     | "other";

   export interface SeedEntry {
     id: string;              // stable slug, e.g. "kbbq.wagyu-short-rib"
     name: string;            // canonical display name
     aliases: string[];       // lowercased, for matching
     cuisine: Cuisine;
     category?: string;       // optional free-text, maps to Item.category
     typicalValue: number;    // USD, midpoint
     valueLow: number;        // USD, lower bound of typical restaurant à la carte
     valueHigh: number;       // USD, upper bound
     fillFactor: number;      // 1–10
   }

   export const SEED_CATALOG: readonly SeedEntry[] = [ /* … */ ];
   ```
2. Curate 200–350 entries. Rough target distribution:
   - KBBQ: 25 (short rib, brisket, bulgogi, pork belly, etc.)
   - Sushi: 40 (nigiri varieties, sashimi, rolls, hand rolls)
   - Chinese buffet: 25 (General Tso's, lo mein, egg rolls, etc.)
   - Dim sum: 25 (har gow, siu mai, char siu bao, etc.)
   - Hot pot: 20 (beef rolls, fish balls, vegetables, noodles, broths)
   - Brazilian / churrasco: 15 (picanha, sirloin, chicken hearts, etc.)
   - Indian buffet: 20 (tikka masala, biryani, naan, samosas, etc.)
   - Pizza: 10 (slices by style + wings)
   - Seafood buffet: 15 (crab legs, shrimp, oysters, etc.)
   - Dessert: 15 (mochi, tiramisu, cheesecake slice, etc.)
   For each, set `valueLow`/`valueHigh` to a realistic U.S. urban à la carte range and `typicalValue` to the midpoint. `fillFactor` follows the existing 1–10 semantics from `PLAN.md` ("1 = a single shrimp, 10 = a whole pizza").
3. Export a helper:
   ```ts
   export function findSeedMatches(query: string, limit: number): SeedEntry[];
   ```
   Matching rules (locked):
   - Normalize: lowercase, collapse whitespace, strip diacritics via `.normalize("NFD").replace(/\p{Diacritic}/gu, "")`.
   - Score entries as: exact name match > alias exact match > name starts-with > alias starts-with > name includes > alias includes. Higher score wins.
   - Ties broken by cuisine priority (KBBQ/sushi first — most common AYCE) then alphabetical.
   - Return top `limit` entries; empty query → empty array.
   - Pure function, no side effects, no async.
4. Create `lib/seed-catalog.test.ts` (Vitest):
   - Empty query returns `[]`.
   - `findSeedMatches("short rib", 5)` returns the wagyu short rib entry first.
   - Case-insensitive: `findSeedMatches("SUSHI", 5)` matches the sushi entries.
   - Alias match: adding an alias like `"california roll"` resolves even when the canonical name is different.
   - Diacritics: `findSeedMatches("crème brûlée", 3)` matches a `creme brulee` entry.
   - `limit` respected.
5. Do **not** touch `lib/types.ts`, `lib/store.ts`, or any `app/` file in this step.

**Verification.**
- [ ] `npm test -- lib/seed-catalog.test.ts` green.
- [ ] `npm run build` green.
- [ ] `grep -n "any" lib/seed-catalog.ts lib/seed-catalog.test.ts` returns zero hits.
- [ ] Catalog entry count ≥ 200 and covers all 10 cuisines.
- [ ] Spot-check: 5 randomly chosen entries have price ranges that match a quick sanity check (e.g., nigiri ≈ $3–6, wagyu short rib ≈ $15–22, har gow ≈ $5–7).

**Exit criteria.** `lib/seed-catalog.ts` exists, tests pass, no other files modified.

**Anti-patterns.**
- ❌ Don't invent fictional cuisines. Stick to the 10 listed.
- ❌ Don't put `typicalValue > valueHigh` or `< valueLow`. Add a test assertion for all entries if practical.
- ❌ Don't depend on `fuse.js` or any fuzzy-match library.
- ❌ Don't hardcode U.S. city names or per-city pricing. One typical-US range only.
- ❌ Don't expose `SEED_CATALOG` from `lib/store.ts` — the store stays free of catalog coupling.

**Rollback.** Delete the two new files. No state changes elsewhere.

---

## Step 2 — Extend `Item` Type + Store

**Context brief (cold-start).**
`lib/types.ts` currently defines `Item` with `id, name, alaCarteValue, fillFactor, category?`. `lib/store.ts` has a Zustand store persisted to `localStorage` under key `"ayce-mon-storage"`. `addItemToLibrary` takes `Omit<Item, "id">` and synthesizes an id via `crypto.randomUUID()`. Existing persisted sessions in users' browsers must keep working — do not break the shape.

**Tasks.**
1. In `lib/types.ts` add:
   ```ts
   export type PriceSource = "user" | "seed" | "estimate";
   ```
   and extend `Item`:
   ```ts
   export interface Item {
     id: ItemId;
     name: string;
     alaCarteValue: number;
     fillFactor: number;
     category?: string;
     sourceKind?: PriceSource;
     sourceRef?: string;
   }
   ```
   Both new fields are **optional**.
2. In `lib/store.ts`, `addItemToLibrary` already uses `Omit<Item, "id">` (verified at lines 21 and 48–58 as of plan drafting) — the new optional fields flow through automatically. **Verify** by reading the current signature; **no code change should be needed.** If TypeScript complains, do **not** widen to `any` and do **not** cast. Stop, re-read the type addition in step 1 of this task for a mistake, and fix the type — never the call site.
3. Add a small pure helper `lib/items.ts` (new file) exporting:
   ```ts
   import type { Item, PriceSource } from "./types";
   export function itemSource(item: Item): PriceSource {
     return item.sourceKind ?? "user";
   }
   ```
   so every caller has a single source of truth for "what does undefined mean."
4. Insert a single addendum line into `PLAN.md` at an **exact** location: immediately after line 47 (the closing ```` ``` ```` of the Domain Model code block) and before the blank line that precedes `**Win condition (locked):**` on line 49. The inserted line is:
   ```
   > Addendum: `Item.sourceKind` and `Item.sourceRef` added (both optional) — see plans/robust-price-estimates.md.
   ```
   Do not touch any other line of `PLAN.md`. Do not modify the code block itself. If PLAN.md has drifted and the line numbers no longer match, insert the line after the code block's closing fence and before the "Win condition (locked):" heading.
5. Run the full existing test suite — **nothing should regress.**

**Verification.**
- [ ] `npm test` green across the whole suite (`lib/calc.test.ts`, `lib/optimizer.test.ts`, existing stuff).
- [ ] `npm run build` green.
- [ ] `grep -n "any" lib/types.ts lib/items.ts lib/store.ts` returns zero hits.
- [ ] Load the app (`npm run dev`), confirm an existing persisted session from before the change still hydrates without errors (watch DevTools console).

**Exit criteria.** Types extended, helper in place, PLAN.md has the one-line addendum, all existing tests green.

**Anti-patterns.**
- ❌ Don't make `sourceKind` required — it would invalidate every persisted item.
- ❌ Don't bump the Zustand `persist` version / add a migrate fn. Not needed for pure additive optional fields.
- ❌ Don't duplicate the `"user" | "seed" | "estimate"` union inline anywhere — use `PriceSource`.
- ❌ Don't change `addItemToLibrary`'s call sites yet — Step 3 does that.

**Rollback.** Revert `lib/types.ts`, delete `lib/items.ts`, revert the `PLAN.md` one-line addendum.

---

## Step 3 — Suggestion UI in the Add Item Dialog

**Context brief (cold-start).**
The Add Item dialog lives in `app/library/page.tsx` — a shadcn `Dialog` with inputs for name, value (USD), fillFactor (slider 1–10), category. Users currently type a name and a dollar value from scratch. This step adds an autocomplete that, as the user types the name, surfaces matching `SeedEntry`s from Step 1's `findSeedMatches`. Selecting one pre-fills value/fillFactor/category and tags `sourceKind: "seed"`. Typing a fully custom name and submitting still works and is tagged `sourceKind: "user"`.

**Prerequisite — verify Step 0 decision on combobox approach.** If Step 0 chose `shadcn add command popover`, run that install first. If handrolled, skip.

**Tasks.**
1. Build a small presentational component `components/item-suggest.tsx`. **Lock this props contract now** — Step 5 will re-use it as-is, not rewrite it:
   ```tsx
   import type { PriceSource } from "@/lib/types";
   import type { SeedEntry } from "@/lib/seed-catalog";

   export type SuggestionEntry =
     | { kind: "seed"; entry: SeedEntry }
     | { kind: "estimate"; name: string; estimate: number; low: number; high: number };

   interface Props {
     value: string;                                            // current name input
     onChange: (next: string) => void;                         // typing
     onPick: (suggestion: SuggestionEntry, source: PriceSource) => void;
     inputId: string;
   }
   ```
   In Step 3, only `kind: "seed"` is emitted and `source` is always `"seed"`. Step 5 adds the `kind: "estimate"` path without changing the props. Internally Step 3's implementation calls `findSeedMatches(value, 6)` and renders the existing shadcn `Input` styled exactly as today (`h-11 text-base`), plus a dropdown listing matches with name + `$low–high` + cuisine chip. Keyboard: ↑/↓ navigation, Enter selects, Escape closes. Click outside closes. Debounce not necessary in Step 3 (match is in-memory).
2. In `app/library/page.tsx`, replace the plain name `Input` with `<ItemSuggest … />`. Add three new pieces of local state:
   ```ts
   const [pickedSource, setPickedSource] = useState<PriceSource>("user");
   const [pickedSourceRef, setPickedSourceRef] = useState<string | undefined>(undefined);
   const [pickedRefName, setPickedRefName] = useState<string | undefined>(undefined);
   ```
3. `onPick(suggestion, source)` handler in `app/library/page.tsx`:
   - If `suggestion.kind === "seed"`: set `name = suggestion.entry.name`, `alaCarteValue = String(suggestion.entry.typicalValue)`, `fillFactor = suggestion.entry.fillFactor`, `category = suggestion.entry.category ?? ""`, `pickedSource = source` (which is always `"seed"` in Step 3), `pickedSourceRef = suggestion.entry.id`, and store `pickedRefName = suggestion.entry.name` (used by task 4's invalidation).
   - The `kind === "estimate"` branch is **out of scope for Step 3** — add it in Step 5.
4. **Invalidation rule (locked) — implement as a pure function to avoid race bugs.**
   ```ts
   // In components/item-suggest-helpers.ts:
   export function computeSource(
     pickedRefName: string | undefined,
     currentName: string
   ): { sourceKind: PriceSource; clearRef: boolean } {
     if (pickedRefName === undefined) return { sourceKind: "user", clearRef: false };
     if (currentName.trim() === pickedRefName.trim()) return { sourceKind: "seed", clearRef: false };
     return { sourceKind: "user", clearRef: true };
   }
   ```
   Call this from the name-field `onChange` handler. When `clearRef === true`, reset `pickedSource = "user"`, `pickedSourceRef = undefined`, `pickedRefName = undefined`. Rationale: a renamed item is no longer the seeded entity. **Do not** compare against `entry.name` directly inside the `ItemSuggest` component — the pick handler itself synchronously fires `onChange(entry.name)` via controlled-input rerender, which would falsely invalidate the pick it just made. Using a dedicated `pickedRefName` snapshot avoids that race.
5. On submit, pass the extra fields to `addItemToLibrary`:
   ```ts
   addItemToLibrary({
     name: name.trim(),
     alaCarteValue: Number(alaCarteValue),
     fillFactor,
     category: category.trim() || undefined,
     sourceKind: pickedSource,
     sourceRef: pickedSourceRef,
   });
   ```
6. Add a tiny inline hint next to the value field when `pickedSource === "seed"`: `typical $low–high` in `text-xs text-muted-foreground`, absolute positioned to the right of the input or under it. Disappears the moment the user edits the value. (Rationale: sets expectations without nagging.)
7. Reset `pickedSource`, `pickedSourceRef`, and `pickedRefName` in `resetForm()`. (The existing `resetForm` is called from the Dialog's `onOpenChange` handler when closing, so close-to-manual-open resets correctly.)
8. **Tests for this step are pure unit tests only.** This project does **not** have React Testing Library, `jsdom`, or `happy-dom` installed (verified in `package.json`), and `vitest.config.ts` has no DOM environment. Do **not** install them here — scope creep.
   - Instead, extract the pick-handler logic into a pure helper inside `components/item-suggest.tsx` (or a sibling `components/item-suggest-helpers.ts`) that takes `(currentName: string, pickedEntry: SeedEntry)` and returns the next form state patch plus the `{ sourceKind, sourceRef }` pair. Unit-test that helper in Vitest without a DOM.
   - Also unit-test the invalidation rule (see task 4 below) as a pure function: `computeSource(pickedRefName, currentName) → PriceSource`.
   - **DOM-level coverage of the full flow (typing, dropdown interaction, pick, submit) is deferred to the Playwright E2E extension in Step 6.** This is intentional — Playwright is already wired up.

**Verification.**
- [ ] `npm test` green.
- [ ] `npm run build` green.
- [ ] Manual: open `/library`, click Add item, type "nigiri", select a suggestion — verify value, fill, category pre-fill.
- [ ] Manual: type a name that has no seed match (e.g. "zzz mystery item"), enter a value manually, submit — verify the item appears and the value is what you typed.
- [ ] Manual: refresh the page after adding a seeded item — confirm it persists correctly via localStorage.
- [ ] Grep `components/item-suggest.tsx`, `components/item-suggest-helpers.ts`, and `app/library/page.tsx` for `: any\b`, `<any[,>]`, and `\bas any\b` — all three return zero hits.

**Exit criteria.** The suggestion UI is usable, selecting a suggestion pre-fills all three fields, the edit-after-pick invalidation works, all tests pass.

**Anti-patterns.**
- ❌ Don't render the dropdown through a Portal if it breaks the Dialog's focus trap. Stay inside the dialog.
- ❌ Don't auto-submit on suggestion click. Clicking just fills the fields.
- ❌ Don't hide or disable the manual value input when a suggestion is picked.
- ❌ Don't trigger matching on an empty query — return early.
- ❌ Don't import `SEED_CATALOG` directly from `app/library/page.tsx`. Go through `findSeedMatches`.

**Rollback.** Delete `components/item-suggest.tsx`, revert `app/library/page.tsx` to the plain Input.

---

## Step 4 — Source Badge on Library Cards

**Context brief (cold-start).**
Library cards in `app/library/page.tsx` render each item with its name, `$value`, `fill X/10`, and optional category badge. This step adds a second small badge indicating the price source: "typical" (seed), "estimated" (LLM, if Step 5 is ever enabled), or nothing at all for user-entered. Purpose: build user trust and make it obvious which values are trustworthy vs. their own best guess.

**Tasks.**
1. In `app/library/page.tsx`, next to the existing category `Badge`, render a source badge:
   ```tsx
   import { itemSource } from "@/lib/items";
   // …
   {itemSource(item) === "seed" && (
     <Badge variant="outline" className="text-xs">typical</Badge>
   )}
   {itemSource(item) === "estimate" && (
     <Badge variant="outline" className="text-xs">estimated</Badge>
   )}
   ```
2. No other visual changes. Keep layout identical.
3. Add an accessible title/tooltip attribute: `title="Pre-filled from seed catalog"` / `title="Pre-filled by LLM estimate"`.
4. No unit test added in this step — there is no existing library test file to maintain. Playwright coverage is added in Step 6.

**Verification.**
- [ ] `npm run build` green.
- [ ] Manual: add a seeded item (Step 3) and a manual item, confirm only the seeded one shows "typical".
- [ ] Existing Playwright E2E from Phase 6 still passes (`npx playwright test`).

**Exit criteria.** Badge renders correctly for seed and estimate sources, nothing for user entries.

**Anti-patterns.**
- ❌ Don't show a "user" badge. Absence of badge is the user state — less visual noise.
- ❌ Don't make the badge clickable. It's purely informational.
- ❌ Don't change badge variant globally; use `variant="outline"` inline only for this.

**Rollback.** Remove the two JSX blocks in `app/library/page.tsx`.

---

## Step 5 — (Optional) LLM Fallback Route Handler

> **⚠ Optional + feature-gated.** This step is only worth doing if the seed catalog misses enough real-world user input to warrant the integration. Skip this entire step if you want to ship faster. When skipped, go directly from Step 4 to Step 6.

**Context brief (cold-start).**
When the user types a name that has no seed match, we'd like to pre-fill the value anyway using Claude Haiku 4.5's knowledge of typical à la carte prices. The API key cannot be exposed to the browser, so we route through a Next.js Route Handler (`app/api/estimate-price/route.ts`). Responses are cached client-side in a new `localStorage` key to avoid paying per keystroke.

**Tasks.**
1. Create `app/api/estimate-price/route.ts`:
   ```ts
   export const runtime = "nodejs";
   export async function POST(req: Request): Promise<Response> {
     // parse { name: string, cuisine?: string }
     // call Anthropic Messages API with Haiku 4.5
     // return { estimate: number, low: number, high: number, confidence: "low"|"med"|"high" }
     // 400 on bad input, 500 on upstream error with { error } body
   }
   ```
   Use the exact SDK import + request shape recorded in the Step 0 Decisions block. Prompt the model for structured JSON output and validate the shape server-side before returning. Reject any response where `low > estimate || estimate > high`.
2. Require env var `ANTHROPIC_API_KEY`. If missing at runtime, return 503 with `{ error: "estimation disabled" }`. Do **not** throw — the Add Item dialog should degrade gracefully.
3. **Server-side rate limiting (hard task, not a TODO).** Implement a simple in-memory token bucket inside the route module: `Map<ip, { tokens: number; lastRefill: number }>`, 10 requests per minute per IP, refill 1 token every 6 seconds. Read IP from the `x-forwarded-for` header (first value) or the `Request`'s remote address, fall back to `"unknown"`. On bucket exhaustion return 429 with `{ error: "rate limited" }`. Rationale: the route handler, once deployed, is trivially abusable otherwise. Because the bucket is in-memory and per-instance, this is best-effort but sufficient for v1.
4. Feature-gate the client side behind `process.env.NEXT_PUBLIC_PRICE_ESTIMATE_LLM === "1"`. If unset, `components/item-suggest.tsx` skips the LLM fallback entirely.
5. In `components/item-suggest.tsx`, when `findSeedMatches` returns `[]` **and** the user has stopped typing for 500ms **and** name length ≥ 3:
   - Check localStorage cache key `ayce-estimate-cache`. Shape:
     ```ts
     type EstimateCache = Record<
       string, // key = `${cuisine ?? "any"}|${normalizedName}` — cuisine is REQUIRED in the key to prevent "salmon at a sushi bar" colliding with "salmon at a churrascaria"
       { estimate: number; low: number; high: number; confidence: "low" | "med" | "high"; ts: number }
     >;
     ```
   - Cache hit: call `onPick` with `{ kind: "estimate", name, estimate, low, high }` and `source: "estimate"`.
   - Cache miss: fire `POST /api/estimate-price`, show a tiny "estimating…" spinner, on 200 write to cache (including `confidence`) and call `onPick`. On 429/503/any non-200, silently fall back to manual entry — the user can always type the value.
6. The `onPick` contract is **already** `(suggestion, source)` from Step 3 — the `source: "estimate"` branch was locked at that point. Do not change the `ItemSuggest` props type; just add the new code path inside the component that emits `{ kind: "estimate", ... }`.
7. Error handling in the UI: if the request fails or returns 429/503, silently fall back to fully manual entry. No error toast. The user never asked to see an LLM in the first place.
8. Tests (unit only — no DOM, matching Step 3's discipline):
   - Route handler unit test with a mocked `Anthropic` client — assert it rejects invalid inputs (non-string `name`, missing body), rejects upstream responses where `low > estimate || estimate > high`, handles upstream errors with 500, honors rate limiting after 10 hits from the same IP in under a minute.
   - Pure-function test for the cache-key builder: `buildCacheKey(cuisine, name)` — cuisine `undefined` → `"any|..."`; diacritic and case normalization applied.
   - DOM-level coverage of the full fetch → pre-fill flow is covered by the Playwright E2E extension in Step 6 under the `NEXT_PUBLIC_PRICE_ESTIMATE_LLM=1` env.

**Verification.**
- [ ] `npm test` green.
- [ ] `npm run build` green.
- [ ] With `NEXT_PUBLIC_PRICE_ESTIMATE_LLM` unset, the dialog behaves exactly as after Step 3 — no network calls, no fallback path.
- [ ] With the flag set and a valid `ANTHROPIC_API_KEY`, typing a novel item name after 500ms triggers exactly one request; a repeat of the same name triggers zero (cache hit).
- [ ] `grep -rn "ANTHROPIC_API_KEY" components/ app/` returns matches only in `app/api/estimate-price/route.ts` (never in client code).
- [ ] Grep `app/api/estimate-price/route.ts` and `components/item-suggest.tsx` for `: any\b`, `<any[,>]`, `\bas any\b` — all three return zero hits.
- [ ] Rate-limit test: with the flag set, fire 11 requests from the same client within 60 s and assert the 11th returns 429.

**Exit criteria.** Feature works end-to-end behind the flag; is completely inert when the flag is off; never blocks the manual path.

**Anti-patterns.**
- ❌ Don't call the route handler from the browser without debouncing.
- ❌ Don't log the API key anywhere, including error traces returned to the client.
- ❌ Don't cache errors in the client cache — only cache valid successful responses.
- ❌ Don't trust the model's JSON output without schema validation.
- ❌ Don't send the user's entire library to the server — only `{ name, cuisine? }`.
- ❌ Don't block the Add Item dialog's submit button while waiting for an estimate. Submit is always active.
- ❌ Don't ship without the in-memory rate limiter (task 3). The route handler is trivially abusable otherwise — anyone who finds the public URL can burn the Anthropic budget in a loop.

**Rollback.** Delete `app/api/estimate-price/` and the LLM branch in `components/item-suggest.tsx`. The feature flag makes rollback zero-risk: just unset the env var.

---

## Step 6 — Tests, E2E, Verification

**Context brief (cold-start).**
Phase 6 of `PLAN.md` established a Playwright happy-path spec at `e2e/happy-path.spec.ts`. This step extends it to cover the new suggestion flow and runs the full verification gauntlet.

**Tasks.**
1. Extend `e2e/happy-path.spec.ts`:
   - After the "Add items" phase, use the new suggestion dropdown: type "short rib" into the name field, click the first suggestion, and assert that the value, fill, and category inputs reflect the seeded values before the user hits Add.
   - Add a second case: type "definitely not in the catalog xyz", enter a value manually, submit — assert the item appears with no "typical" badge.
   - Re-run through the existing combos → tracker → result flow to confirm no regression.
2. Run the full test suite: `npm test` (unit) + `npx playwright test` (E2E). All green.
3. Run `npm run build`. No warnings beyond the baseline.
4. Run these greps (via the `Grep` tool with ripgrep, not naked grep) and confirm zero hits in the relevant directories:
   - `: any\b` — catches type annotations `foo: any`
   - `<any[,>]` — catches generics `Array<any>` and `Promise<any, …>`
   - `\bas any\b` — catches `as any` casts
   - (All three run against `lib/`, `app/`, `components/`, `*.ts` + `*.tsx`.)
   - `TODO|FIXME` — one allowed exception: the Step 5 rate-limit note, if Step 5 was implemented. Any other hit is a blocker.
   - `console\.log` — zero hits.
   Do **not** use the naive `"any"` substring grep from `PLAN.md` Phase 6 — it matches `many`, `company`, `anyone`, etc. and gives false negatives on real `any` types.
5. Manual walkthrough on 375px viewport:
   - Setup → Library → Add item via suggestion → Add item manually → Combos → Tracker → Result.
   - Confirm the suggestion dropdown is usable at mobile width (doesn't overflow, keyboard navigation works on touch keyboards).
6. Append a short "Done" note at the bottom of this plan file with the final entry count of the seed catalog and whether Step 5 was shipped.

**Verification (final acceptance).**
- [ ] `npm test` green.
- [ ] `npx playwright test` green.
- [ ] `npm run build` clean.
- [ ] No `any`, no stray `TODO` (except the documented Step 5 rate-limit note), no `console.log`.
- [ ] `/library` Add Item dialog is usable at 375px with and without the suggestion dropdown open.
- [ ] Existing persisted sessions from before this plan still load without errors.

**Exit criteria.** All checkboxes above, "Done" note appended to this file.

**Anti-patterns.**
- ❌ Don't mute Playwright flake by retrying without investigation.
- ❌ Don't add `@ts-ignore` to make the build green.
- ❌ Don't skip the manual walkthrough — the suggestion UX is the whole point of this plan and needs a human eye.

---

## Out of scope for this plan

Good ideas I explicitly don't want sneaking in — save them for follow-up plans:

- Region-aware pricing (NYC vs rural Ohio à la carte prices differ — not this plan).
- Multi-currency. USD only, per `PLAN.md`.
- Photo recognition of menu items.
- Learning from the user's own overrides ("every time you added wagyu you set $20, so we'll remember"). This is a cloud-sync feature in disguise.
- Scraping restaurant menus from Yelp / Google Places. ToS minefield.
- Importing from Spoonacular / Nutritionix / Edamam. Covered in the Background table — not useful enough to justify the license risk.
- Admin UI for editing the seed catalog. It's a bundled TS module; edit the file.
- Localization / i18n of seed catalog names.

---

## Done

- Seed catalog entry count: **212** (kbbq 25, sushi 40, chinese 25, dimsum 25, hotpot 20, brazilian 15, indian 20, pizza 10, seafood 15, dessert 16, other 1)
- Step 5 shipped: **no** (skipped by design — seed catalog alone covers the target use case at zero runtime cost)
- Final `npm test`: **53/53 pass** (2026-04-08)
- Final `npx playwright test`: **1/1 pass** (2026-04-08)
- Final `npm run build`: **clean** (Next.js 16.2.2 / Turbopack / strict TS)
- Grep gates: `\bany\b` / `<any[,>]` / `\bas any\b` / `TODO|FIXME` / `console\.log` across `lib/`, `app/`, `components/` — all zero hits.
