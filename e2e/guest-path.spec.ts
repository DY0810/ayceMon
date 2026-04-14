import { test, expect, type Page } from "@playwright/test";

// One test, end-to-end happy path from PLAN.md Phase 6 task 3.
// Walks: setup → library → combos → tracker → result.

test.describe("happy path", () => {
  test.beforeEach(async ({ page }) => {
    // One-time clear. addInitScript fires on every document load, which
    // races with subsequent page.goto(...) calls that happen after the
    // store has persisted — those full-document navigations would wipe
    // the session and redirect the test back to /setup.
    await page.goto("/");
    await page.evaluate(() => window.localStorage.clear());
  });

  test("setup → library → combos → tracker → result", async ({ page }) => {
    // 1. Open app and click the CTA to /setup. The home page is a marketing
    //    hero with a "Start a session" CTA that links to /setup.
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /make your money worth/i })
    ).toBeVisible();
    await page.getByRole("link", { name: "Start a session" }).click();
    await expect(page).toHaveURL(/\/setup$/);

    // 2. Fill the setup form and submit.
    await expect(
      page.getByRole("heading", { name: "Start a session" })
    ).toBeVisible();
    await page.getByLabel(/restaurant/i).fill("KBBQ Town");
    await page.getByLabel(/buffet price/i).fill("35");
    // Pick the premium city tier so seeded prices are visibly adjusted
    // upward — this lets a later assertion prove the multiplier applied.
    await page.getByLabel(/city tier/i).selectOption("metro-premium");
    // Phase 2: appetite budget is now a preset-chip group. Pick "Typical"
    // (1200 g) — store writes appetiteBudgetGrams=1200 and legacy
    // appetiteBudget=50.
    await page.getByRole("button", { name: /^Typical/ }).click();
    await page.getByRole("button", { name: "Start session" }).click();

    // Submit redirects to /library.
    await expect(page).toHaveURL(/\/library$/);
    await expect(
      page.getByRole("heading", { name: "Library" })
    ).toBeVisible();

    // 3. Add 3 items — exercise both the new suggestion dropdown AND the
    //    manual fallback path.
    //
    // (a) Suggestion path: type "wagyu short rib" (narrow enough to match
    //     "Wagyu Short Rib" exactly — score 100 beats the generic "short
    //     rib" substring matches). This should pre-fill value/fill/category
    //     without the user touching the value field. We then confirm the
    //     library card shows the "typical" badge and the value is
    //     tier-adjusted upward (metro-premium applies a +20% multiplier —
    //     Wagyu Short Rib's raw typical is $22, so the adjusted value
    //     should be >$24).
    const shortRibValue = await addLibraryItemViaSuggestion(page, {
      query: "wagyu short rib",
    });
    expect(shortRibValue).toBeGreaterThan(24);

    // (b) Manual path: type a name that has no seed match and enter every
    //     field by hand. The resulting card should NOT have the "typical"
    //     badge.
    await addLibraryItem(page, {
      name: "mystery buffet item xyz",
      value: "12",
      grams: 120,
    });
    await addLibraryItem(page, {
      name: "salad",
      value: "3",
      grams: 30,
    });

    // Confirm all three items are in the library before moving on. The
    // seeded item uses the seed catalog's canonical display name, which
    // may be any case — we look for the remove button's name via regex.
    await expect(
      page.getByRole("button", { name: /Remove .*short rib/i })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Remove mystery buffet item xyz" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Remove salad" })
    ).toBeVisible();

    // The seeded short rib card should carry the "typical" badge; the
    // manual mystery-item card should not.
    const shortRibCard = page
      .getByRole("listitem")
      .filter({ has: page.getByRole("button", { name: /Remove .*short rib/i }) });
    await expect(shortRibCard.getByText("typical")).toBeVisible();

    const mysteryCard = page
      .getByRole("listitem")
      .filter({
        has: page.getByRole("button", {
          name: "Remove mystery buffet item xyz",
        }),
      });
    await expect(mysteryCard.getByText("typical")).toHaveCount(0);

    // 4. Visit /combos and apply the top suggestion.
    await page.goto("/combos");
    await expect(
      page.getByRole("heading", { name: "Combos" })
    ).toBeVisible();
    const useComboButton = page
      .getByRole("button", { name: "Use this combo" })
      .first();
    await expect(useComboButton).toBeVisible();
    await useComboButton.click();

    // 5. On /tracker, verify the totals reflect the pre-loaded combo.
    await expect(page).toHaveURL(/\/tracker$/);
    await expect(
      page.getByRole("button", { name: "Finish meal" })
    ).toBeVisible();

    const progressBar = page.getByRole("progressbar", {
      name: "Money worth progress",
    });
    await expect(progressBar).toBeVisible();

    // The Eaten total should be non-zero because a combo was applied.
    // The tracker has two "Live totals" landmarks: a mobile <section>
    // (lg:hidden, format "$X / $35.00") and a desktop <aside> (hidden
    // below lg, format "$X of $35.00"). Playwright runs at 1280×720 by
    // default, so we read the visible desktop aside.
    const totalsLine = page.getByText(/^\$\d+(?:\.\d{2})? of \$35\.00$/);
    await expect(totalsLine).toBeVisible();
    const totalsText = (await totalsLine.textContent()) ?? "";
    const eatenMatch = totalsText.match(/^\$(\d+(?:\.\d{2})?) of \$35\.00$/);
    expect(eatenMatch).not.toBeNull();
    const eatenValue = Number(eatenMatch?.[1] ?? "0");
    expect(eatenValue).toBeGreaterThan(0);

    // The progressbar should also report a non-zero value.
    const progressValue = await progressBar.getAttribute("aria-valuenow");
    expect(progressValue).not.toBeNull();
    expect(Number(progressValue)).toBeGreaterThan(0);

    // 6. Click +1 on the seeded short rib item once. The button's aria
    //    name is derived from the item's canonical catalog name (e.g.
    //    "Add one Wagyu Short Rib") — regex-match for robustness.
    await page
      .getByRole("button", { name: /Add one .*short rib/i })
      .click();

    // 7. Click "Finish meal".
    await page.getByRole("button", { name: "Finish meal" }).click();

    // 8. On /result, assert headline + breakdown row count.
    await expect(page).toHaveURL(/\/result$/);
    const headline = page.getByRole("heading", { level: 1 });
    await expect(headline).toBeVisible();
    await expect(headline).toHaveText(/won/i);

    // Breakdown rows: one <tr> per distinct item with units > 0. The store
    // drops eaten entries when units hit 0, so every rendered row is a
    // distinct item with units > 0 by construction. Sanity-check both the
    // count is in [1, 3] and that every Units cell parses to > 0.
    const rows = page.locator("table tbody tr");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThanOrEqual(1);
    expect(rowCount).toBeLessThanOrEqual(3);

    let nonZeroRowCount = 0;
    for (let i = 0; i < rowCount; i++) {
      const unitsText =
        (await rows.nth(i).locator("td").nth(1).textContent()) ?? "";
      const units = Number(unitsText.trim());
      expect(Number.isFinite(units)).toBe(true);
      if (units > 0) nonZeroRowCount++;
    }
    expect(nonZeroRowCount).toBe(rowCount);
  });
});

interface LibraryItemInput {
  name: string;
  value: string;
  grams: number;
}

// Opens the Add-item dialog, fills the form (name, à la carte value,
// grams per unit), and submits. Phase 2: the 1–10 fill-factor slider
// was replaced by a numeric grams-per-unit input; the legacy fillFactor
// is derived on submit via Math.round(grams/30), clamped to [1,10].
async function addLibraryItem(
  page: Page,
  { name, value, grams }: LibraryItemInput
): Promise<void> {
  await page.getByRole("button", { name: "Add item" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "Add an item" })
  ).toBeVisible();

  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel(/à la carte value/i).fill(value);
  await dialog.getByLabel(/grams per unit/i).fill(String(grams));

  await dialog.getByRole("button", { name: "Add to library" }).click();
  await expect(dialog).toBeHidden();
}

interface SuggestionInput {
  query: string;
}

// Opens the Add-item dialog, types a query into the name combobox, waits
// for the suggestion listbox, picks the first option, and submits. The
// picked seed entry is expected to pre-fill the value, fillFactor, and
// category fields — this helper does NOT touch them. Returns the pre-
// filled value as a number so callers can assert tier adjustment.
async function addLibraryItemViaSuggestion(
  page: Page,
  { query }: SuggestionInput
): Promise<number> {
  await page.getByRole("button", { name: "Add item" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const nameInput = dialog.getByLabel("Name");
  await nameInput.click();
  await nameInput.fill(query);

  // Wait for the handrolled listbox to render and pick the first option.
  const listbox = dialog.getByRole("listbox");
  await expect(listbox).toBeVisible();
  const firstOption = listbox.getByRole("option").first();
  await expect(firstOption).toBeVisible();
  await firstOption.click();

  // After the pick the value field should have been pre-filled to a
  // numeric string — verify it is non-empty and > 0 before submitting.
  const valueField = dialog.getByLabel(/à la carte value/i);
  const valueText = await valueField.inputValue();
  expect(valueText).not.toBe("");
  const pickedValue = Number(valueText);
  expect(pickedValue).toBeGreaterThan(0);

  await dialog.getByRole("button", { name: "Add to library" }).click();
  await expect(dialog).toBeHidden();

  return pickedValue;
}
