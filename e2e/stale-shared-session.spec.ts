import { test, expect, type Page } from "@playwright/test";

// Bug reproduction (2026-04-14): when Zustand has a stale `sharedSessionId`
// that the server no longer recognizes (local DB reset, collaborator
// removed, cookie race, etc.), a redirect loop formed between /result,
// /setup's arrival gate, and /tracker:
//
//   /result → sees sharedSession === null → replace("/setup")
//   /setup gate → sharedSessionId !== null → replace("/tracker")
//   /tracker → shared.error === "not_found" → replace("/setup")
//   repeat
//
// The fix: when the tracker/result redirect guards fire on not_found,
// they also clear sharedSessionId so the next /setup render treats the
// state as "no active session" and renders the form.
//
// This spec forces the loop condition by seeding a sharedSessionId and
// stubbing /api/shared-session/:id to always 404, then asserts the user
// lands on /setup with the form visible (no bounce).

const STALE_SESSION_ID = "00000000-0000-0000-0000-00000000dead";

function staleSharedSnapshot(): string {
  return JSON.stringify({
    state: {
      session: null,
      finishedSessions: [],
      sharedSessionId: STALE_SESSION_ID,
      sharedSessionFinishedAt: null,
    },
    version: 0,
  });
}

async function stubSharedApi404(page: Page): Promise<void> {
  await page.route(
    `**/api/shared-session/${STALE_SESSION_ID}`,
    async (route) => {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "not_found" }),
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

test.describe("stale shared session recovery", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => window.localStorage.clear());
  });

  test("landing on /result with stale sharedSessionId settles on /setup with form visible", async ({
    page,
  }) => {
    await stubSharedApi404(page);
    await seed(page, staleSharedSnapshot());

    await page.goto("/result");
    // Allow up to 10s for the (current) loop to settle, once cleared. The
    // fixed version should reach /setup within ~1s; the unfixed version
    // bounces forever and this waitForURL will time out.
    await page.waitForURL(/\/setup$/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/setup$/);
    await expect(
      page.getByRole("heading", { name: "Start a session" }).first(),
    ).toBeVisible();

    // Zustand must have cleared the stale id — otherwise reloading /setup
    // would re-trigger the arrival gate and bounce again.
    const stored = await page.evaluate(() =>
      window.localStorage.getItem("ayce-mon-storage"),
    );
    expect(stored).not.toContain(STALE_SESSION_ID);
  });

  test("landing on /tracker with stale sharedSessionId settles on /setup with form visible", async ({
    page,
  }) => {
    await stubSharedApi404(page);
    await seed(page, staleSharedSnapshot());

    await page.goto("/tracker");
    await page.waitForURL(/\/setup$/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/setup$/);
    await expect(
      page.getByRole("heading", { name: "Start a session" }).first(),
    ).toBeVisible();

    const stored = await page.evaluate(() =>
      window.localStorage.getItem("ayce-mon-storage"),
    );
    expect(stored).not.toContain(STALE_SESSION_ID);
  });
});
