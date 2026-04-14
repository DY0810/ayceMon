import { test, expect, type Page } from "@playwright/test";

// Post-plan gate (2026-04-14):
//
//   /setup   — redirects to /tracker while any session (solo OR shared) is
//              in progress. Finished-draft sessions still allow /setup so
//              users can begin their next meal.
//   /combos  — redirects to /tracker whenever sharedSessionId is set,
//              because the combo optimizer reads the Zustand solo session
//              (not populated in shared/invite mode). No-session still
//              redirects to /setup.
//
// Same technique as e2e/result-gate.spec.ts: seed the Zustand persist slot
// via localStorage, stub /api/shared-session/[id] when needed, navigate,
// assert redirect (or lack of one).

const SHARED_SESSION_ID = "00000000-0000-0000-0000-000000000d00";
const ISO_NOW = "2026-04-14T00:00:00.000Z";

function soloSnapshot(finished: boolean): string {
  const now = Date.now();
  return JSON.stringify({
    state: {
      session: {
        id: "solo-gate-session",
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

function sharedSnapshot(finished: boolean): string {
  return JSON.stringify({
    state: {
      session: null,
      finishedSessions: [],
      sharedSessionId: SHARED_SESSION_ID,
      sharedSessionFinishedAt: finished ? Date.now() : null,
    },
    version: 0,
  });
}

function emptySnapshot(): string {
  return JSON.stringify({
    state: {
      session: null,
      finishedSessions: [],
      sharedSessionId: null,
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
  await page.goto("/");
  await page.evaluate(
    ({ snapshot }) => {
      window.localStorage.setItem("ayce-mon-storage", snapshot);
    },
    { snapshot },
  );
}

test.describe("setup gate", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => window.localStorage.clear());
  });

  test("no session → /setup renders the form", async ({ page }) => {
    await seed(page, emptySnapshot());

    await page.goto("/setup");
    await expect(page).toHaveURL(/\/setup$/);
    // The page has multiple H1s (mobile + desktop variants both say
    // "Start a session"); assert at least one is visible.
    await expect(
      page.getByRole("heading", { name: "Start a session" }).first(),
    ).toBeVisible();
  });

  test("solo in-progress → /setup redirects to /tracker", async ({ page }) => {
    await seed(page, soloSnapshot(false));

    await page.goto("/setup");
    await page.waitForURL(/\/tracker$/);
    await expect(page).toHaveURL(/\/tracker$/);
  });

  test("solo finished → /setup still allows starting a new session", async ({
    page,
  }) => {
    await seed(page, soloSnapshot(true));

    await page.goto("/setup");
    await expect(page).toHaveURL(/\/setup$/);
    await expect(
      page.getByRole("heading", { name: "Start a session" }).first(),
    ).toBeVisible();
  });

  test("shared in-progress → /setup redirects to /tracker", async ({ page }) => {
    await stubSharedApi(page, false);
    await seed(page, sharedSnapshot(false));

    await page.goto("/setup");
    await page.waitForURL(/\/tracker$/);
    await expect(page).toHaveURL(/\/tracker$/);
  });

  test("shared finalized → /setup allows starting a new session", async ({
    page,
  }) => {
    await stubSharedApi(page, true);
    await seed(page, sharedSnapshot(true));

    await page.goto("/setup");
    await expect(page).toHaveURL(/\/setup$/);
    await expect(
      page.getByRole("heading", { name: "Start a session" }).first(),
    ).toBeVisible();
  });
});

test.describe("combos gate", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => window.localStorage.clear());
  });

  test("solo in-progress → /combos renders the optimizer", async ({ page }) => {
    await seed(page, soloSnapshot(false));

    await page.goto("/combos");
    await expect(page).toHaveURL(/\/combos$/);
    await expect(
      page.getByRole("heading", { name: "Combos" }).first(),
    ).toBeVisible();
  });

  test("shared in-progress → /combos redirects to /tracker", async ({ page }) => {
    await stubSharedApi(page, false);
    await seed(page, sharedSnapshot(false));

    await page.goto("/combos");
    await page.waitForURL(/\/tracker$/);
    await expect(page).toHaveURL(/\/tracker$/);
  });

  test("no session → /combos redirects to /setup", async ({ page }) => {
    await seed(page, emptySnapshot());

    await page.goto("/combos");
    await page.waitForURL(/\/setup$/);
    await expect(page).toHaveURL(/\/setup$/);
  });
});
