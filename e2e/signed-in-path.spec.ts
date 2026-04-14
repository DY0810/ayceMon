import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Test user seeded via the service-role admin client. Cascade-deleted in
// afterAll so session_records / restaurants rows are cleaned up too.
// ---------------------------------------------------------------------------
const TEST_EMAIL = `e2e-${Date.now()}@test.aycemon.local`;
const TEST_PASSWORD = "Test1234!";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

let testUserId: string | null = null;

test.describe("signed-in path", () => {
  test.beforeAll(async () => {
    // Seed a dedicated test user via the admin API (bypasses email confirmation).
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error) throw new Error(`Failed to seed test user: ${error.message}`);
    testUserId = data.user.id;
  });

  test.afterAll(async () => {
    // Cascade-delete the test user (session_records FK is ON DELETE CASCADE).
    if (testUserId) {
      await supabaseAdmin.auth.admin.deleteUser(testUserId);
    }
  });

  test.beforeEach(async ({ page }) => {
    // Clear any prior client state so we start fresh.
    await page.goto("/");
    await page.evaluate(() => window.localStorage.clear());
  });

  test("sign in → setup → library → tracker → finish → history → stats", async ({
    page,
  }) => {
    // 1. Sign in via the login form.
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "Log in" }),
    ).toBeVisible();
    await page.getByLabel(/email/i).fill(TEST_EMAIL);
    await page.getByLabel(/password/i).fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();

    // After login the app redirects to /.
    await page.waitForURL("/", { timeout: 10_000 });

    // 2. Go to /setup, fill in a session. Use a manual restaurant name since
    //    the E2E env may not have a valid GOOGLE_PLACES_API_KEY. The combobox
    //    falls back to a free-text manual name in that case.
    await page.goto("/setup");
    await expect(
      page.getByRole("heading", { name: "Start a session" }),
    ).toBeVisible();

    // Fill the restaurant field — the combobox renders an input with
    // label "Restaurant". Type a name; if the Places API is not configured
    // the combobox just stores it as a manual name.
    await page.getByLabel(/restaurant/i).fill("E2E Test Buffet");
    await page.getByLabel(/buffet price/i).fill("40");
    await page.getByLabel(/appetite budget/i).fill("25");
    await page.getByRole("button", { name: "Start session" }).click();
    await expect(page).toHaveURL(/\/library$/);

    // 3. Add 3 items to the library.
    await addLibraryItem(page, { name: "Salmon sashimi", value: "16", fillFactor: 3 });
    await addLibraryItem(page, { name: "Wagyu beef", value: "22", fillFactor: 7 });
    await addLibraryItem(page, { name: "Edamame", value: "4", fillFactor: 1 });

    // 4. Navigate to tracker and eat some items.
    await page.goto("/tracker");
    await expect(
      page.getByRole("button", { name: "Finish meal" }),
    ).toBeVisible();

    // Click +1 on Salmon sashimi twice and Wagyu beef once.
    await page
      .getByRole("button", { name: /Add one Salmon sashimi/i })
      .click();
    await page
      .getByRole("button", { name: /Add one Salmon sashimi/i })
      .click();
    await page
      .getByRole("button", { name: /Add one Wagyu beef/i })
      .click();

    // 5. Finish the meal. Signed-in users always save to DB (restaurant_id
    //    is nullable now), so this routes to /history/[id].
    await page.getByRole("button", { name: "Finish meal" }).click();
    await page.waitForURL(/\/history\//, { timeout: 10_000 });

    // 6. The detail page should show the session headline.
    const headline = page.getByRole("heading", { level: 1 });
    await expect(headline).toBeVisible();
    // total = 16*2 + 22*1 = 54, buffet = 40 → won
    await expect(headline).toHaveText(/won/i);

    // 7. Navigate to /history. The session we just finished should appear.
    await page.goto("/history");
    await expect(
      page.getByRole("heading", { name: "History" }),
    ).toBeVisible();
    // Verify our session row is present.
    await expect(page.getByText("E2E Test Buffet")).toBeVisible();

    // 8. Navigate to /stats.
    await page.goto("/stats");
    await expect(
      page.getByRole("heading", { name: "Stats" }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Helpers (same pattern as guest-path.spec.ts)
// ---------------------------------------------------------------------------
interface LibraryItemInput {
  name: string;
  value: string;
  fillFactor: number;
}

async function addLibraryItem(
  page: Page,
  { name, value, fillFactor }: LibraryItemInput,
): Promise<void> {
  await page.getByRole("button", { name: "Add item" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel(/à la carte value/i).fill(value);

  const slider = dialog.getByRole("slider");
  await slider.focus();
  const delta = fillFactor - 5;
  const key = delta < 0 ? "ArrowLeft" : "ArrowRight";
  for (let i = 0; i < Math.abs(delta); i++) {
    await page.keyboard.press(key);
  }
  await expect(dialog.getByText(`${fillFactor} / 10`)).toBeVisible();

  await dialog.getByRole("button", { name: "Add to library" }).click();
  await expect(dialog).toBeHidden();
}
