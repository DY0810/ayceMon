import { test, expect, type Page } from "@playwright/test";

// Phase 4 (collab-and-quantitative-appetite): /result must redirect to
// /tracker when the active session — solo OR shared — has not been
// finalized. The four-case truth table this file exercises:
//
//   1. Solo in-progress  (session.finishedAt === undefined) → redirect
//   2. Solo finished     (session.finishedAt set)           → stay on /result
//   3. Shared in-progress (shared.finished_at === null)      → redirect
//   4. Shared finished    (shared.finished_at set)           → stay on /result
//
// The shared-session cases stub the GET /api/shared-session/[id] route so
// the suite doesn't depend on Supabase/auth. Solo cases seed the Zustand
// persist slot directly via localStorage before navigating, which is the
// same technique used by `e2e/guest-path.spec.ts`.

const SHARED_SESSION_ID = "00000000-0000-0000-0000-00000000abc0";

const ISO_NOW = "2026-04-14T00:00:00.000Z";

function soloSnapshot(finished: boolean): string {
  const now = Date.now();
  return JSON.stringify({
    state: {
      session: {
        id: "solo-test-session",
        restaurantName: "Gate Test Buffet",
        buffetPrice: 35,
        appetiteBudget: 50,
        appetiteBudgetGrams: 1200,
        library: [],
        eaten: [],
        startedAt: now,
        ...(finished ? { finishedAt: now } : {}),
      },
      finishedSessions: [],
      sharedSessionId: null,
      sharedSessionFinishedAt: null,
    },
    version: 0,
  });
}

function sharedSnapshot(): string {
  return JSON.stringify({
    state: {
      session: null,
      finishedSessions: [],
      sharedSessionId: SHARED_SESSION_ID,
      sharedSessionFinishedAt: null,
    },
    version: 0,
  });
}

function sharedApiBody(finished: boolean): string {
  return JSON.stringify({
    session: {
      id: SHARED_SESSION_ID,
      owner_user_id: "owner-uid",
      restaurant_id: null,
      restaurant_name: "Shared Gate Buffet",
      buffet_price: 40,
      appetite_budget: 50,
      appetite_budget_grams: "1200",
      city_tier: null,
      resolved_place: null,
      started_at: ISO_NOW,
      finished_at: finished ? ISO_NOW : null,
      created_at: ISO_NOW,
    },
    items: [],
    entries: [],
    collaborators: [
      {
        session_id: SHARED_SESSION_ID,
        user_id: "owner-uid",
        role: "owner",
        joined_at: ISO_NOW,
      },
    ],
  });
}

async function stubSharedApi(page: Page, finished: boolean): Promise<void> {
  await page.route(
    `**/api/shared-session/${SHARED_SESSION_ID}`,
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: sharedApiBody(finished),
      });
    },
  );
}

async function seed(page: Page, snapshot: string): Promise<void> {
  // Write the persist slot before the first app render so Zustand hydrates
  // from our seeded state instead of an empty store. The home page is the
  // lightest entry — we then navigate again to exercise the redirect guard.
  await page.goto("/");
  await page.evaluate(
    ({ snapshot }) => {
      window.localStorage.setItem("ayce-mon-storage", snapshot);
    },
    { snapshot },
  );
}

test.describe("result gate", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => window.localStorage.clear());
  });

  test("solo in-progress → /result redirects to /tracker", async ({ page }) => {
    await seed(page, soloSnapshot(false));

    await page.goto("/result");
    await page.waitForURL(/\/tracker$/);
    await expect(page).toHaveURL(/\/tracker$/);
  });

  test("solo finished → /result renders", async ({ page }) => {
    await seed(page, soloSnapshot(true));

    await page.goto("/result");
    await expect(page).toHaveURL(/\/result$/);
    // The result headline ("You won!", "Almost —", or "Right on the line.")
    // only renders after the gate lets the page through.
    const headline = page.getByRole("heading", { level: 1 });
    await expect(headline).toBeVisible();
  });

  test("shared in-progress (owner) → /result redirects to /tracker", async ({
    page,
  }) => {
    await stubSharedApi(page, false);
    await seed(page, sharedSnapshot());

    await page.goto("/result");
    await page.waitForURL(/\/tracker$/);
    await expect(page).toHaveURL(/\/tracker$/);
  });

  test("shared finalized → /result renders", async ({ page }) => {
    await stubSharedApi(page, true);
    await seed(page, sharedSnapshot());

    await page.goto("/result");
    await expect(page).toHaveURL(/\/result$/);
    const headline = page.getByRole("heading", { level: 1 });
    await expect(headline).toBeVisible();
  });
});
