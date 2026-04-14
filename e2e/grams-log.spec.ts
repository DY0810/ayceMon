import { test, expect, type Page } from "@playwright/test";

// Phase 3 — inline `+g` grams input in solo mode.
// Walks a guest user through setup → library → tracker, then logs 200g
// against a manually-added library item and asserts:
//   1. The tracker's "Fill" summary renders the new gram total ("200g / 1200g").
//   2. The `+g` button regains focus after a successful submit (focus management
//      in plan task 3 is part of the acceptance criteria).

test.describe("grams log", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => window.localStorage.clear());
  });

  test("solo: `+g` logs grams and updates fullness row", async ({ page }) => {
    await page.goto("/setup");
    await expect(
      page.getByRole("heading", { name: "Start a session" }),
    ).toBeVisible();
    await page.getByLabel(/restaurant/i).fill("Grams Test Buffet");
    await page.getByLabel(/buffet price/i).fill("35");
    await page.getByRole("button", { name: /^Typical/ }).click();
    await page.getByRole("button", { name: "Start session" }).click();

    await expect(page).toHaveURL(/\/library$/);
    await addManualLibraryItem(page, {
      name: "grams only item",
      value: "12",
      grams: 150,
    });

    await page.goto("/tracker");
    await expect(
      page.getByRole("button", { name: "Finish meal" }),
    ).toBeVisible();

    // Fullness label initially renders 0g (nothing eaten yet). The desktop
    // aside is the visible Live-totals landmark at Playwright's default
    // 1280×720 viewport (mobile section is lg:hidden).
    const desktopTotals = page.getByRole("complementary", {
      name: "Live totals",
    });
    await expect(desktopTotals).toContainText(/0g \/ 1200g/);

    // Click the `+g` button on the item card to reveal the inline input.
    // The aria-label matches the existing `+1` naming convention so screen
    // readers can describe what "+g" will do.
    const addGramsButton = page.getByRole("button", {
      name: /Log grams for grams only item/i,
    });
    await addGramsButton.click();

    const gramsInput = page.getByLabel(/Grams to log for grams only item/i);
    await expect(gramsInput).toBeVisible();
    await gramsInput.fill("200");

    await page
      .getByRole("button", { name: /Submit grams for grams only item/i })
      .click();

    // After commit: input collapses, fullness row reflects the new total,
    // and focus returns to the `+g` button (per plan task 3).
    await expect(gramsInput).toHaveCount(0);
    await expect(desktopTotals).toContainText(/200g \/ 1200g/);
    await expect(addGramsButton).toBeFocused();
  });
});

interface LibraryItemInput {
  name: string;
  value: string;
  grams: number;
}

async function addManualLibraryItem(
  page: Page,
  { name, value, grams }: LibraryItemInput,
): Promise<void> {
  await page.getByRole("button", { name: "Add item" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel(/à la carte value/i).fill(value);
  await dialog.getByLabel(/grams per unit/i).fill(String(grams));
  await dialog.getByRole("button", { name: "Add to library" }).click();
  await expect(dialog).toBeHidden();
}
