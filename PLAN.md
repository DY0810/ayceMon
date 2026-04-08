# ayceMon — Implementation Plan

> **Goal:** A web app that helps you "make your money worth" at all-you-can-eat restaurants. You enter the buffet price and a library of items with their à la carte values. The app suggests high-value combos to target, lets you track what you actually eat, and tells you if you won.

## Stack Decisions (locked)

- **Platform:** Next.js (App Router) web app
- **Data input:** Manual entry per session (no pre-built restaurant DB)
- **Value model:** Both — suggest combos pre-meal, track actual mid/post-meal
- **Persistence:** `localStorage` only (no backend, no auth — single-device per user)
- **Language:** TypeScript
- **Styling:** Tailwind CSS v4 + shadcn/ui components
- **State:** Zustand store (persisted to localStorage)
- **Testing:** Vitest + React Testing Library for units; Playwright for one happy-path E2E

---

## Domain Model (single source of truth — copy verbatim into Phase 1)

```ts
// types.ts
export type ItemId = string;

export interface Item {
  id: ItemId;
  name: string;            // "Wagyu short rib"
  alaCarteValue: number;   // dollars per unit, e.g. 18
  fillFactor: number;      // 1–10, "how filling is one unit" (10 = a whole pizza)
  category?: string;       // optional, e.g. "meat", "sushi", "dessert"
}

export interface EatenEntry {
  itemId: ItemId;
  units: number;           // can be fractional (0.5 of a roll)
}

export interface Session {
  id: string;
  restaurantName?: string;
  buffetPrice: number;     // what you paid to enter
  appetiteBudget: number;  // total fillFactor units you can stomach (e.g. 30)
  library: Item[];         // items available at this restaurant
  eaten: EatenEntry[];     // what you've actually consumed
  startedAt: number;       // unix ms
  finishedAt?: number;
}
```

> Addendum: `Item.sourceKind` and `Item.sourceRef` added (both optional) — see plans/robust-price-estimates.md.

**Win condition (locked):**

```
totalEatenValue = Σ (item.alaCarteValue × entry.units)
youWon = totalEatenValue >= session.buffetPrice
margin = totalEatenValue - session.buffetPrice   // positive = profit
```

**Anti-patterns to guard against (every phase):**
- ❌ Don't introduce a backend, database, or user auth — localStorage only.
- ❌ Don't add categories/tags as required fields — `category` is optional.
- ❌ Don't invent additional fields on `Item` or `Session` beyond the model above without updating this plan.
- ❌ Don't use `any` in TypeScript. Strict mode on from day one.
- ❌ Don't pull in heavy state libs (Redux, Jotai). Zustand only.

---

## Phase 0 — Documentation Discovery & Stack Verification

**Goal:** Confirm exact APIs/CLIs/versions before any code is written. Output is a short "Allowed APIs" list pasted into Phase 1.

### Tasks
1. Run `npx create-next-app@latest --help` and record the current flag names (don't assume `--app`, `--ts`, `--tailwind` still exist).
2. Visit https://ui.shadcn.com/docs/installation/next and record the exact init command for the current shadcn version.
3. Visit https://zustand.docs.pmnd.rs/integrations/persisting-store-data and copy the canonical `persist` middleware example into a scratch note.
4. Confirm the Tailwind v4 install path (it ships via PostCSS plugin in current Next templates — verify, don't assume).
5. Note the current Node version requirement for Next.js (read `engines` after scaffold).

### Deliverable (paste at top of Phase 1)

```
# Allowed APIs (Phase 0 output)
- Next.js scaffold command: <exact command from step 1>
- shadcn init command:      <exact command from step 2>
- Zustand persist import:   <exact import path from step 3>
- Tailwind install path:    <verified per step 4>
- Node engine:              <from package.json after scaffold>
```

### Verification
- [ ] Each line above has a real source URL or local file path next to it.
- [ ] No assumed flags or imports — every entry was actually executed/read.

---

## Phase 1 — Project Scaffold + Domain Model + Store

**What to implement:** A working Next.js app that boots, with the domain types and Zustand store wired up. No UI yet beyond a placeholder home page.

### Tasks
1. Run the exact `create-next-app` command from Phase 0 to create the project **in place** at `/Users/dyl/ayceMon` (use `.` as the project name). Choose: TypeScript, ESLint, Tailwind, App Router, no `src/` dir, no import alias beyond default `@/*`.
2. Run the shadcn init command from Phase 0. Add components: `button`, `input`, `card`, `dialog`, `progress`, `badge`.
3. Install Zustand: `npm i zustand`.
4. Create `lib/types.ts` — paste the **Domain Model** block from this plan verbatim.
5. Create `lib/store.ts` — Zustand store with `persist` middleware (copy the canonical example from Phase 0). Store shape:
   ```ts
   interface AyceStore {
     session: Session | null;
     startSession: (input: { restaurantName?: string; buffetPrice: number; appetiteBudget: number }) => void;
     endSession: () => void;
     addItemToLibrary: (item: Omit<Item, "id">) => void;
     removeItemFromLibrary: (id: ItemId) => void;
     logEaten: (itemId: ItemId, units: number) => void;
     clearEaten: () => void;
   }
   ```
6. Create `lib/calc.ts` with three pure functions (these are the math core — fully unit-tested in Phase 5):
   ```ts
   export function totalEatenValue(session: Session): number;
   export function margin(session: Session): number;          // positive = profit
   export function didYouWin(session: Session): boolean;
   ```
7. Replace `app/page.tsx` with a placeholder that reads from the store and shows `"No active session"` or `"Active session at {restaurantName} — buffet $X"`.

### Verification
- [ ] `npm run dev` boots cleanly with no console errors.
- [ ] `npm run build` succeeds with strict TS.
- [ ] Refreshing the page preserves any session you've created (proves persist works).
- [ ] `grep -r "any" lib/` returns zero hits (no `any` types).

### Anti-pattern guards
- ❌ Don't write the setup form yet — that's Phase 2.
- ❌ Don't put math inside the store. Keep `lib/calc.ts` pure functions on `Session`.
- ❌ Don't import server-only APIs in store/calc — they're client-side.

---

## Phase 2 — Session Setup + Item Library CRUD

**What to implement:** The "before you sit down" screens — start a session, add items to your library.

### Tasks
1. Create `app/setup/page.tsx` — form with: restaurant name (optional), buffet price (required, number ≥ 0), appetite budget (required, number 1–100, default 30). On submit calls `startSession` and routes to `/library`.
2. Create `app/library/page.tsx` — shows `session.library` as a list of cards. Each card shows name, value ($), fill factor, optional category. Each card has a delete button calling `removeItemFromLibrary`.
3. On the same page, an "Add item" button opens a shadcn `Dialog` with a form: name, value, fillFactor (slider 1–10), category (optional). On submit calls `addItemToLibrary`.
4. Add a top nav bar (`components/nav.tsx`) shown on all session pages: links to Setup / Library / Combos / Tracker / Result. Disable links when there's no active session.
5. If a user lands on `/library` with no session, redirect to `/setup`.

### Verification
- [ ] You can fill the setup form, land on /library, add 5 items, refresh, and they persist.
- [ ] Deleting an item removes its card immediately and survives refresh.
- [ ] Required-field validation works (can't submit empty buffet price).
- [ ] Nav links are disabled (not just hidden) when there's no session.

### Anti-pattern guards
- ❌ Don't build a "categories management" screen — categories are free-text only.
- ❌ Don't add image upload. Text-only items.
- ❌ Don't use `useState` for the form values that need to persist across navigations — use the store. (Local form state during typing is fine.)

---

## Phase 3 — Combo Suggester (the optimizer)

**What to implement:** Given the library and the appetite budget, suggest the highest-total-value combo of items that fits.

### Algorithm spec (locked — copy into `lib/optimizer.ts`)

This is a **bounded knapsack** problem:
- **Capacity:** `session.appetiteBudget` (sum of fillFactor × units must not exceed)
- **Item weight:** `item.fillFactor`
- **Item value:** `item.alaCarteValue`
- **Bound:** assume max 10 units of any single item (prevents degenerate "eat 30 short ribs" answers)

Use a **DP knapsack** (capacity is small — ≤100, items small — ≤50 typical). If capacity ever exceeds 200, fall back to a greedy by `value / fillFactor` and note this in a comment.

```ts
// lib/optimizer.ts
export interface ComboSuggestion {
  picks: Array<{ itemId: ItemId; units: number }>;
  totalValue: number;
  totalFill: number;
}

export function suggestCombo(session: Session): ComboSuggestion;
// Returns the highest-value combo within appetiteBudget.

export function suggestTopN(session: Session, n: number): ComboSuggestion[];
// Returns up to N diverse combos (e.g. force-include each highest-value item once).
```

### Tasks
1. Create `lib/optimizer.ts` with the two functions above. Implement DP knapsack first; greedy fallback only if needed.
2. Write unit tests in `lib/optimizer.test.ts` covering: empty library, single item, capacity zero, capacity exactly fits one item, two items where one dominates, the bounded case (10-unit cap).
3. Create `app/combos/page.tsx` — calls `suggestTopN(session, 3)`, displays each combo as a card with total value, total fill, and a list of picks. Each combo card has a "Use this combo" button that pre-fills the tracker (Phase 4) by calling `clearEaten()` and then `logEaten` for each pick.
4. Show a comparison: each combo's `totalValue` vs `session.buffetPrice` with a green check / red x.

### Verification
- [ ] Unit tests pass: `npm test lib/optimizer.test.ts`.
- [ ] With a library of `[steak $20 fill 5, salad $3 fill 2]` and budget 10, optimizer picks 2 steaks (value $40), not 5 salads (value $15).
- [ ] Combos page shows at least one suggestion when library has items.
- [ ] "Use this combo" button populates the eaten log correctly (verify in Phase 4).

### Anti-pattern guards
- ❌ Don't call the optimizer on every render. Memoize with `useMemo` keyed on `session.library` and `session.appetiteBudget`.
- ❌ Don't suggest fractional units in pre-meal combos (whole units only). Fractional is for the actual tracker.
- ❌ Don't hide items the user added — every library item should be eligible for the optimizer.

---

## Phase 4 — Live Tracker

**What to implement:** Mid-meal screen where you tap items to log what you've actually eaten, with a live "money worth" progress bar.

### Tasks
1. Create `app/tracker/page.tsx` showing every library item as a card with `+1`, `+0.5`, and `-1` buttons that call `logEaten(itemId, delta)`. Show current units eaten next to each item.
2. At the top, a sticky `Progress` bar showing `totalEatenValue / buffetPrice` capped visually at 100% with the actual percentage as text (e.g. "$47 / $35 — 134%"). Bar turns green at ≥100%.
3. Below the bar: live totals — total value eaten, margin (`+$12.00` green or `-$8.50` red), units consumed vs appetite budget.
4. A "Finish meal" button at the bottom — sets `session.finishedAt` and routes to `/result`.

### Verification
- [ ] Tapping `+1` on a $10 item bumps total by exactly $10 and persists across refresh.
- [ ] `-1` doesn't take units below 0.
- [ ] Progress bar reaches green when total ≥ buffet price.
- [ ] "Finish meal" routes to /result and disables further edits (handled in Phase 5).

### Anti-pattern guards
- ❌ Don't recompute totals from scratch on every button click in the component — use a `useMemo` over `session.eaten` and `session.library`.
- ❌ Don't add a timer / "race against the clock" mode. Out of scope.

---

## Phase 5 — Result Screen + Calc Unit Tests

**What to implement:** Post-meal verdict + the unit test suite for the math core.

### Tasks
1. Create `app/result/page.tsx`:
   - Big headline: "You won! +$12.50" or "Almost — you were $4.25 short."
   - Breakdown table: every eaten item, units, per-unit value, line total.
   - Footer: "Total eaten: $X / Buffet price: $Y / Margin: $Z".
   - Buttons: "Edit log" (back to /tracker, clears `finishedAt`) and "End session" (calls `endSession`, routes to `/setup`).
2. Write `lib/calc.test.ts` — exhaustive tests for `totalEatenValue`, `margin`, `didYouWin`:
   - Empty eaten array → 0, negative margin, false.
   - Eaten exactly equal to buffet price → margin 0, win = **true** (≥, not >).
   - Fractional units multiplied correctly.
   - Item in `eaten` whose `itemId` no longer exists in library → contributes 0 (don't crash).
3. Add a top-level `npm test` script if not present.

### Verification
- [ ] All `lib/calc.test.ts` cases pass.
- [ ] Result screen renders correctly for a known sample session.
- [ ] "Edit log" round-trips you back to a fully editable tracker.

### Anti-pattern guards
- ❌ Don't celebrate fractionally (`"You won by 2 cents"`). If margin is between -$0.50 and $0.50, the headline says "Right on the line."
- ❌ Don't crash if the library was edited mid-session and an `eaten.itemId` is dangling. Skip it gracefully.

---

## Phase 6 — Polish, E2E, Verification

**What to implement:** One Playwright happy-path E2E, mobile-first CSS pass, and final cleanup.

### Tasks
1. Mobile-first review: every page must be usable at 375px wide. Use Chrome devtools mobile emulation to verify. Fix any overflow or unreadable text.
2. Install Playwright: `npm init playwright@latest` (use the current scaffold).
3. Write `e2e/happy-path.spec.ts`:
   - Open app → /setup
   - Fill restaurant "KBBQ Town", buffet $35, appetite 25
   - Add 3 items (short rib $18 fill 5, brisket $12 fill 4, salad $3 fill 1)
   - Visit /combos, click "Use this combo" on the top suggestion
   - Visit /tracker, verify the bar shows the pre-loaded total
   - Click +1 on short rib once, click "Finish meal"
   - On /result, assert headline contains "won" and breakdown row count is correct
4. Run `grep -rn "any" lib/ app/ components/` — must return zero hits.
5. Run `grep -rn "TODO\|FIXME" lib/ app/ components/` — must return zero hits.
6. Run `npm run build` — must succeed with no warnings.
7. Manual: clear localStorage, walk through the app from scratch, confirm every redirect works.

### Verification (final acceptance)
- [ ] Phase 5 unit tests pass (`npm test`).
- [ ] Playwright E2E passes (`npx playwright test`).
- [ ] `npm run build` is clean.
- [ ] No `any`, no `TODO`, no `console.log` in `lib/`, `app/`, or `components/`.
- [ ] Mobile (375px) usable on every page.
- [ ] localStorage clear → setup → library → combos → tracker → result works end-to-end without errors.

### Anti-pattern guards
- ❌ Don't add features mid-polish (no analytics, no share-image, no dark mode toggle unless trivially free from Tailwind defaults).
- ❌ Don't suppress TypeScript errors with `@ts-ignore` to ship.

---

## Out-of-scope (explicitly deferred)

These ideas are good but **not in this plan**. Don't sneak them in:
- Photo / camera entry
- Pre-built restaurant menus
- Multiple concurrent sessions / history
- Sharing results via image or link
- User accounts / cloud sync
- Time-based AYCE limits ("90 minute window")
- Group/multiplayer mode
- Calorie tracking
- Currency other than USD

If you want any of these, they're a follow-up plan.
