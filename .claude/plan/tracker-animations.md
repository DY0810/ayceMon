# Tracker animations (zero-dep)

## Goal
Add tasteful motion to ayceMon without slowing down meal logging or adding bundle weight. Animations should reinforce the core feedback loop ("the number is climbing toward $35.00") rather than decorate it.

## Constraints
- **No new dependencies.** Pure CSS + a small RAF-based React hook.
- **Respect `prefers-reduced-motion`.** Reduced-motion users get instant updates.
- **Don't break the e2e test.** No accessibility-tree changes; the same `aria-label`s, roles, and visible text formats stay intact.
- **Don't slow taps.** Animations are fire-and-forget; the underlying state updates immediately.

## Already in place (verified, no work needed)
- `components/ui/progress.tsx:48` — `ProgressIndicator` already uses `transition-all`, so the bar fills smoothly when its value changes.
- `components/ui/button.tsx:7` — Button already has `active:not-aria-[haspopup]:translate-y-px` for press feedback.

## Tasks

### T1. `useAnimatedNumber` hook
**File:** `lib/use-animated-number.ts` (new)
- Takes `(value: number, options?: { durationMs?: number })`. Default 350ms.
- On value change, tweens from previous value to new value via `requestAnimationFrame`. Returns the current displayed value.
- Easing: ease-out cubic (`1 - (1 - t)^3`).
- If `prefers-reduced-motion: reduce` matches, returns the target value immediately on every change.
- Cleans up RAF on unmount and on rapid successive value changes (cancel previous frame).
- Pure client-side; export as named hook. No `"use client"` directive on the file (the consuming components already have it).

### T2. Animate tracker totals
**File:** `app/tracker/page.tsx`
- Import `useAnimatedNumber`.
- Wrap three values:
  - `totals.totalValue` → `displayedTotal`
  - `rawPercent` → `displayedPercent`
  - `totals.marginValue` → `displayedMargin`
- Use `displayedTotal` everywhere `totals.totalValue.toFixed(2)` is shown (mobile sticky and desktop aside — both occurrences).
- Use `Math.round(displayedPercent)` everywhere `Math.round(rawPercent)` is shown.
- Recompute `formattedMargin` from `displayedMargin` (preserve `marginIsPositive` from the *target*, not the displayed, value, so the tone doesn't flicker mid-tween).
- The line totals on each item card (`lineTotal = units * item.alaCarteValue`) stay un-tweened — they'd be too noisy with 5+ items animating in parallel, and the headline number is what carries the emotional weight.
- **Critical:** the e2e test reads the totals span as `^\$\d+(?:\.\d{2})? of \$35\.00$`. The animated value must still produce that exact format (`toFixed(2)`). Verify by re-running playwright.

### T3. Win-moment pulse
**File:** `app/tracker/page.tsx` + (new) tiny CSS keyframe in `app/globals.css`
- Track previous `wins` boolean across renders. When it flips `false → true`, trigger a one-shot animation key (e.g., increment a counter in a ref/state).
- Apply a `data-celebrate={key}` attribute to the desktop progress bar wrapper (or use a key prop on a wrapper to remount-triggered animation).
- CSS: a 600ms keyframe that pulses the bar — `scale(1) → scale(1.02) → scale(1)` plus a brief brightness bump on the indicator color. No layout shift (only `transform` + `filter`).
- Wrap in `@media (prefers-reduced-motion: no-preference)` so reduced-motion users get nothing.
- Don't fire on first hydration if `wins` was already true (i.e., resuming a finished meal).

### T4. Home hero entrance
**File:** `app/page.tsx` + `app/globals.css`
- Pure CSS keyframe `fade-up` (translateY 12px → 0, opacity 0 → 1, 500ms ease-out).
- Apply with staggered `animation-delay` to: h1, lead paragraph, CTA link, then the 4 "How it works" cards (60ms stagger).
- Wrap the keyframe + utility classes inside `@media (prefers-reduced-motion: no-preference)` so reduced-motion shows everything immediately at full opacity.
- Default state (no animation): elements at their final position. The animation REPLACES the from-state, so reduced-motion users still see the page correctly.
- One-shot only (no `animation-iteration-count` > 1).

## Verification
1. `npx tsc --noEmit` — clean.
2. `npx vitest run` — 28/28.
3. `npx playwright test --reporter=list` — 1 passed. (The animated totals must still match the regex; the heading + CTA on `/` must still be hittable.)
4. Manual check (browser at :3000):
   - Tap +1 on tracker → number rolls smoothly, percentage rolls smoothly.
   - Cross the buffet price → progress bar pulses once.
   - Reload `/` → hero fades up in stagger.
   - Toggle macOS Reduce Motion → animations disabled, page still functional.

## Out of scope (deliberately not doing)
- Framer Motion / motion library — adds bundle weight, overkill for this.
- Confetti / particles on win — too gimmicky for a utility app.
- Page route transitions — felt sluggish in testing.
- Animating the per-item line totals — too noisy with many items.
- Animating the Fill display — fractional unit display already feels stable.
