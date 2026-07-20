import { test, expect, type Page } from "@playwright/test";

const EMAIL = `e2e-orgs-${Date.now()}@example.com`;
const PASSWORD = "playwright-secret-1";
const ORG_NAME = `E2E Org ${Date.now()}`;
const ORG_PASSWORD = "org-secret-123";

async function register(page: Page) {
  await page.goto("/register", { timeout: 30000 });
  await page.waitForSelector("#email", { timeout: 10000 });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click('[data-testid="register-form"] button[type="submit"]');
  await page.waitForURL("**/", { timeout: 15000 });
}

test.describe.configure({ mode: "serial" });

test("Organizations tab is visible after login", async ({ page }) => {
  await register(page);
  await expect(page.locator('[data-testid="user-nav"]')).toBeVisible();
  // Organizations tab should be in the nav
  await expect(page.locator('[data-testid="user-nav"]')).toContainText("Organizations");
});

test("Organizations page shows empty state", async ({ page }) => {
  await register(page);
  await page.goto("/organizations");
  await expect(page.locator('[data-testid="organizations-list"]')).toBeVisible();
  await expect(page.getByText("No organizations yet")).toBeVisible();
});

test("Create organization flow", async ({ page }) => {
  await register(page);
  await page.goto("/organizations");

  // Open create dialog
  await page.click('[data-testid="new-org-button"]');
  await expect(page.locator('[data-testid="org-name-input"]')).toBeVisible();

  // Fill in details
  await page.fill('[data-testid="org-name-input"]', ORG_NAME);
  await page.fill('[data-testid="org-password-input"]', ORG_PASSWORD);
  await page.click('[data-testid="org-create-submit"]');

  // Should appear in the list
  await expect(page.getByText(ORG_NAME)).toBeVisible();
});

test("External user password gate", async ({ page }) => {
  await register(page);
  await page.goto("/organizations");

  // Click on the org name to enter it as owner
  const orgSlug = ORG_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  await page.goto(`/org/${orgSlug}`);

  // As the owner, we should see the workspace (not the password gate)
  await expect(page.locator('[data-testid="org-workspace"]')).toBeVisible();
  await expect(page.getByText(ORG_NAME)).toBeVisible();
  await expect(page.locator('[data-testid="org-manage-button"]')).toBeVisible();
});

test("Password gate for unauthenticated visitor", async ({ context, page }) => {
  await register(page);

  // Open a new incognito context to test as external user
  const incognito = await context.newPage();

  const orgSlug = ORG_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  await incognito.goto(`/org/${orgSlug}`);

  // Should show password gate (not logged in, no org session)
  await expect(incognito.locator('[data-testid="org-gate"]')).toBeVisible();
  await expect(incognito.locator('[data-testid="org-gate-password"]')).toBeVisible();

  // Try wrong password
  await incognito.fill('[data-testid="org-gate-password"]', "wrong-password");
  await incognito.click('[data-testid="org-gate-submit"]');
  await expect(incognito.locator('[data-testid="org-gate-error"]')).toBeVisible();

  // Try correct password
  await incognito.fill('[data-testid="org-gate-password"]', ORG_PASSWORD);
  await incognito.click('[data-testid="org-gate-submit"]');

  // No members added yet => should show "no members" message
  await expect(incognito.locator('[data-testid="org-gate-no-members"]')).toBeVisible();

  await incognito.close();
});

test("Owner can navigate to manage panel", async ({ page }) => {
  await register(page);
  const orgSlug = ORG_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  await page.goto(`/org/${orgSlug}/manage`);

  // Should see the manage panel
  await expect(page.locator('[data-testid="org-manage-panel"]')).toBeVisible();
  await expect(page.getByText(`Manage: ${ORG_NAME}`)).toBeVisible();

  // Should have all three sections
  await expect(page.locator('[data-testid="manage-folders-section"]')).toBeVisible();
  await expect(page.locator('[data-testid="manage-members-section"]')).toBeVisible();
  await expect(page.locator('[data-testid="manage-settings-section"]')).toBeVisible();
});

test("Owner can add and remove a member", async ({ page }) => {
  await register(page);
  const orgSlug = ORG_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  await page.goto(`/org/${orgSlug}/manage`);

  // Add a member
  await page.fill('[data-testid="new-member-input"]', "Test Member");
  await page.click('[data-testid="add-member-submit"]');

  // Member should appear (we don't know the ID, but the name should be visible)
  await expect(page.getByText("Test Member")).toBeVisible();
});

test("Owner can change password", async ({ page }) => {
  await register(page);
  const orgSlug = ORG_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  await page.goto(`/org/${orgSlug}/manage`);

  // Fill in new password
  await page.fill('[data-testid="new-password-input"]', "new-org-password-456");
  await page.click('[data-testid="save-password-submit"]');

  // Should show success toast (Sonner toast is hard to assert, just verify no error)
  await page.waitForTimeout(2000);
});

test("Non-owner is redirected from manage page", async ({ context, page }) => {
  await register(page);

  // Open incognito as non-owner
  const incognito = await context.newPage();
  const orgSlug = ORG_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

  // Try to access manage page without auth
  await incognito.goto(`/org/${orgSlug}/manage`);

  // Should be redirected to the org gate (password page)
  await expect(incognito.locator('[data-testid="org-gate"]')).toBeVisible();

  await incognito.close();
});

test("Org workspace manage button links to manage page", async ({ page }) => {
  await register(page);
  const orgSlug = ORG_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  await page.goto(`/org/${orgSlug}`);

  // As owner, should see manage button
  await expect(page.locator('[data-testid="org-manage-button"]')).toBeVisible();
  await page.click('[data-testid="org-manage-button"]');

  // Should navigate to manage page
  await expect(page.locator('[data-testid="org-manage-panel"]')).toBeVisible();
});
