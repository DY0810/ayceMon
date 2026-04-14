# Quantitative Appetite Model

This doc explains why ayceMon measures appetite in **grams of food mass** and how the numbers behind the default budget presets and per-item estimates are grounded in published research.

The prior model (`Item.fillFactor: 1–10`, `Session.appetiteBudget: 1–100`) was author-picked with no empirical basis. Grams replace both.

## Why grams

- **Volume/mass is the dominant satiety signal**, not kcal. Same-kcal meals of greater mass produced significantly more satiety in controlled trials (Rolls 1998).
- **Gastric capacity is characterised in mL** in the medical literature, and food at roughly neutral density gives mL ≈ g (Geliebter 1988).
- **Grams are trivially measurable** at a buffet — food scales, nutrition labels, and restaurant portion guides all speak grams. Per-item kcal varies 10× between fatty and lean foods and would force us to ship a nutrition database we do not need.

kcal was considered and rejected for these reasons. The decision is locked.

## Budget presets

Four default buckets. The user picks one at session start; it maps directly to `Session.appetiteBudgetGrams`.

| Preset | Grams | Who it targets |
|---|---|---|
| Light | 800 g | Smaller appetites or a light meal; below Geliebter's comfort ceiling. |
| Typical | 1200 g | Default. A round number just above the Geliebter comfort ceiling (≈ 900–1100 g). |
| Big | 1800 g | Hearty buffet appetite; well under max distension (~3000 mL). |
| Competitive | 2500 g | Trained / contest-style eaters; still below Levine 2007's ~4 L outlier ceiling. |

The presets are *targets*, not hard caps. The UI shows "100%+ full" past the budget — never an error state.

**Provenance.** The 900–1100 g comfort figure and ~3000 g max distension come from Geliebter 1988. The 2500 g competitive bucket is anchored to Levine 2007's ~4 L training-session observation as an outlier, not a recommendation. "Typical 1200 g" is a round number just above the Geliebter comfort ceiling, **not** a per-meal population median — we deliberately do not cite per-meal intake surveys because we have not independently verified a per-meal (vs. per-day) statistic at source.

## Per-item grams-per-unit

Authors estimate grams per single serving unit when defining an `Item`. Unit means whatever is natural at the restaurant: one shrimp, one slice, one plate. Six reference points:

| Item | Grams per unit |
|---|---|
| One shrimp | ≈ 8 g |
| One piece nigiri | ≈ 20 g |
| One hotpot meat slice | ≈ 25 g |
| One spring roll | ≈ 40 g |
| One slice of pizza | ≈ 120 g |
| One KBBQ plate (cooked) | ≈ 150 g |

Rules of thumb when a number is not on the menu:

- Prefer cooked mass for meats (shrinkage is ~20–30 %).
- Use label grams when available (sushi chains publish per-piece weights).
- Round to the nearest 5 g for small items, nearest 10 g for plates. Precision beyond that is false precision.

## Fullness progress semantics

`fullness % = grams consumed / grams budget`. Computation lives in `lib/calc.ts` and is the single source of truth (plan invariant #1).

- `finishedAt: undefined` → session is in-progress; the bar renders live.
- `finishedAt` set → session is done; the bar freezes at the final percent.
- Past 100 %, the bar caps visually but the numeric label keeps climbing ("128 % full"). The budget is a target, never a cap (plan invariant #13).

Grams consumed equals `Σ item.gramsPerUnit × unitsEaten` over the eaten set. This is identical math to the old fill-factor model — only the unit changes.

## Known limitations

- **Water content is lumped in.** 100 g of watermelon and 100 g of ribeye are the same number here. Volume-based satiety (Rolls 1998) treats them closer to equivalent than kcal would, but individuals differ.
- **Beverages are excluded.** Liquids empty the stomach faster and have a different satiety profile; including them would overweight drink-heavy meals.
- **Individual variation is large.** Gastric capacity at comfortable fullness ranges ≈ 900–1100 mL between sexes in Geliebter 1988, with wider spread across individuals.
- **Not medical advice.** The model is a ballpark planner for buffet pacing, not a dietetic tool or an eating-disorder aid. It is not medically prescriptive.

## References

1. Geliebter A. et al. "Gastric capacity, gastric emptying, and test-meal intake in normal and bulimic women." *Physiology & Behavior*, 1988. — Comfortable fullness ≈ 1100 mL (men), ≈ 900 mL (women); max distension ~3000 mL.
2. Rolls BJ. et al. "Volume of food consumed affects satiety in men." *American Journal of Clinical Nutrition*, 1998. — Greater-volume meals at matched kcal produced significantly more satiety.
3. Levine MS. et al. "Competitive speed eating: truth and consequences." *American Journal of Roentgenology*, 2007. — Trained competitive eaters reached ~4 L during training; treated here as an outlier ceiling, not a target.
