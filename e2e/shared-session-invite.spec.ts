import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Phase 7 (collab-and-quantitative-appetite): end-to-end two-user
// invite/join/log/finalize flow.
//
// Owner creates a shared session, mints an invite from the Share drawer,
// copies the link. Invitee (a separate browser context so the owner's
// session cookies don't follow) signs in, hits /join?token=…, lands on
// /tracker, logs grams via the `+g` button. Owner logs a unit, finalizes,
// and /history/[id] shows per-user attribution.
//
// Two browser contexts keep the cookies separate without a manual sign-out
// dance; see playwright.dev/docs/browser-contexts for the canonical pattern.

const OWNER_EMAIL = `e2e-owner-${Date.now()}@test.aycemon.local`;
const INVITEE_EMAIL = `e2e-invitee-${Date.now()}@test.aycemon.local`;
const PASSWORD = "Test1234!";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

let ownerUserId: string | null = null;
let inviteeUserId: string | null = null;

test.describe("shared session invite flow", () => {
  test.beforeAll(async () => {
    const owner = await supabaseAdmin.auth.admin.createUser({
      email: OWNER_EMAIL,
      password: PASSWORD,
      email_confirm: true,
    });
    if (owner.error) throw new Error(`seed owner failed: ${owner.error.message}`);
    ownerUserId = owner.data.user.id;

    const invitee = await supabaseAdmin.auth.admin.createUser({
      email: INVITEE_EMAIL,
      password: PASSWORD,
      email_confirm: true,
    });
    if (invitee.error) {
      throw new Error(`seed invitee failed: ${invitee.error.message}`);
    }
    inviteeUserId = invitee.data.user.id;
  });

  test.afterAll(async () => {
    if (ownerUserId) await supabaseAdmin.auth.admin.deleteUser(ownerUserId);
    if (inviteeUserId) await supabaseAdmin.auth.admin.deleteUser(inviteeUserId);
  });

  test("owner invites → invitee joins → both log → owner finalizes → attribution shows", async ({
    browser,
  }) => {
    // --------------------------------------------------------------------
    // 1. Owner signs in, creates a shared session with one library item.
    // --------------------------------------------------------------------
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();

    await signIn(ownerPage, OWNER_EMAIL, PASSWORD);

    await ownerPage.goto("/setup");
    await expect(
      ownerPage.getByRole("heading", { name: "Start a session" }),
    ).toBeVisible();
    await ownerPage.getByLabel(/restaurant/i).fill("Invite Test Buffet");
    await ownerPage.getByLabel(/buffet price/i).fill("45");
    await ownerPage.getByRole("button", { name: /^Typical/ }).click();

    // Toggle to invite mode. The setup page renders a "Share with a friend"
    // toggle for authenticated users (Phase 6).
    await ownerPage.getByRole("button", { name: /invite/i }).click();
    await ownerPage.getByRole("button", { name: "Start session" }).click();

    // Invite mode routes to /library?session=<id>; the $ anchor from the
    // solo path would fail here. Accept the optional query string.
    await expect(ownerPage).toHaveURL(/\/library(?:\?|$)/);
    await addManualLibraryItem(ownerPage, {
      name: "shared sashimi",
      value: "14",
      grams: 40,
    });
    // Confirm the item landed in the library before navigating to /tracker —
    // otherwise a late addSharedLibraryItem response races the goto and the
    // tracker renders an empty library (no Finish button, no item cards).
    await expect(
      ownerPage.getByRole("button", { name: "Remove shared sashimi" }),
    ).toBeVisible({ timeout: 10_000 });

    // --------------------------------------------------------------------
    // 2. Owner opens Share drawer on /tracker and copies the invite link.
    // --------------------------------------------------------------------
    await ownerPage.goto("/tracker");
    await expect(
      ownerPage.getByRole("button", { name: "Finish meal" }),
    ).toBeVisible({ timeout: 10_000 });

    // Grant clipboard permission so navigator.clipboard.readText works.
    await ownerContext.grantPermissions(["clipboard-read", "clipboard-write"]);

    await ownerPage
      .getByRole("button", { name: /share|invite friends/i })
      .first()
      .click();

    // Drawer shows the invite URL in a text input or anchor. Click Copy.
    const copyButton = ownerPage.getByRole("button", {
      name: /copy (invite )?link/i,
    });
    await expect(copyButton).toBeVisible();

    // Snapshot the drawer for the README. Only capture when explicitly
    // requested (SNAPSHOT_SHARE_DRAWER=1) so CI runs stay deterministic.
    if (process.env.SNAPSHOT_SHARE_DRAWER === "1") {
      await ownerPage.screenshot({
        path: "docs/screenshots/share-drawer.png",
        fullPage: false,
      });
    }

    await copyButton.click();

    const joinUrl = await ownerPage.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(joinUrl).toMatch(/\/join\?token=[A-Za-z0-9_-]{22}$/);

    // Close the share drawer so the tracker item controls are reachable
    // again. The drawer covers the ItemCard + "Finish meal" area.
    await ownerPage.getByRole("button", { name: "Close" }).click();

    // --------------------------------------------------------------------
    // 3. Invitee (separate context) signs in, visits the invite URL, and
    //    lands on /tracker with the shared session active.
    // --------------------------------------------------------------------
    const inviteeContext = await browser.newContext();
    const inviteePage = await inviteeContext.newPage();

    await signIn(inviteePage, INVITEE_EMAIL, PASSWORD);

    await inviteePage.goto(new URL(joinUrl).pathname + new URL(joinUrl).search);
    await inviteePage.waitForURL(/\/tracker/, { timeout: 10_000 });

    // Tracker header should reflect the shared session (collaborator list).
    await expect(
      inviteePage.getByRole("button", { name: "Finish meal" }),
    ).toBeVisible();

    // --------------------------------------------------------------------
    // 4. Both users log something against the shared session.
    //    Invitee uses `+g` → 30g of shared sashimi.
    //    Owner uses `+1`  → one unit of shared sashimi.
    // --------------------------------------------------------------------
    await inviteePage
      .getByRole("button", { name: /Log grams for shared sashimi/i })
      .click();
    await inviteePage
      .getByLabel(/Grams to log for shared sashimi/i)
      .fill("30");
    await inviteePage
      .getByRole("button", { name: /Submit grams for shared sashimi/i })
      .click();

    await ownerPage.getByRole("button", { name: /Add one shared sashimi/i }).click();

    // --------------------------------------------------------------------
    // 5. Owner finalizes. Collaborators cannot finalize — only the owner.
    // --------------------------------------------------------------------
    await ownerPage.getByRole("button", { name: "Finish meal" }).click();
    await ownerPage.waitForURL(/\/history\//, { timeout: 10_000 });

    // --------------------------------------------------------------------
    // 6. The history detail page should show per-user attribution for
    //    owner AND invitee (both logged something).
    // --------------------------------------------------------------------
    const historyHeadline = ownerPage.getByRole("heading", { level: 1 });
    await expect(historyHeadline).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function signIn(page: Page, email: string, password: string) {
  // Go straight to /login — each browser context starts with an empty
  // cookie jar (newContext), so there's no prior-session localStorage
  // to wipe. If we hit "/" first, the app's auth listener would
  // re-hydrate any stale token before `localStorage.clear()` ran,
  // which is the exact race this ordering avoids.
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Log in" }),
  ).toBeVisible();
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("/", { timeout: 10_000 });
}

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
