import { test, expect } from "@playwright/test";

const EMAIL = `e2e-shell-${Date.now()}@example.com`;
const PASSWORD = "playwright-secret-1";

async function register(page: import("@playwright/test").Page) {
  await page.goto("/register");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click('[data-testid="register-form"] button[type="submit"]');
  await page.waitForURL("**/");
}

test.describe.configure({ mode: "serial" });

test("authenticated pages show the app shell with sidebar and top bar", async ({ page }) => {
  await register(page);

  // Shell should be visible after login
  await expect(page.locator('[data-testid="app-shell"]')).toBeVisible();
  await expect(page.locator('[data-testid="app-sidebar"]')).toBeVisible();
  await expect(page.locator('[data-testid="app-topbar"]')).toBeVisible();
});

test("sidebar contains all three navigation groups", async ({ page }) => {
  await register(page);

  // Three section headers
  await expect(page.locator('[data-testid="sidebar-section-create"]')).toBeVisible();
  await expect(page.locator('[data-testid="sidebar-section-workspace"]')).toBeVisible();
  await expect(page.locator('[data-testid="sidebar-section-settings"]')).toBeVisible();

  // Key nav items exist
  await expect(page.locator('[data-testid="sidebar-item-new-recording"]')).toBeVisible();
  await expect(page.locator('[data-testid="sidebar-item-all-recordings"]')).toBeVisible();
  await expect(page.locator('[data-testid="sidebar-item-action-items"]')).toBeVisible();
  await expect(page.locator('[data-testid="sidebar-item-queue"]')).toBeVisible();
});

test("top bar shows org switcher and user avatar", async ({ page }) => {
  await register(page);

  await expect(page.locator('[data-testid="org-switcher"]')).toBeVisible();
  await expect(page.locator('[data-testid="user-avatar"]')).toBeVisible();
});

test("sidebar navigation to queue page works", async ({ page }) => {
  await register(page);

  await page.click('[data-testid="sidebar-item-queue"]');
  await page.waitForURL("**/queue");
  await expect(page.locator('[data-testid="queue-empty"]')).toBeVisible();
  // Sidebar should still be visible on sub-pages
  await expect(page.locator('[data-testid="app-sidebar"]')).toBeVisible();
});

test("sidebar navigation to settings page works", async ({ page }) => {
  await register(page);

  await page.click('[data-testid="sidebar-item-settings"]');
  await page.waitForURL("**/settings");
  await expect(page.locator('[data-testid="model-picker-deepgram-model"]')).toBeVisible();
});

test("logout via top bar user menu works", async ({ page }) => {
  await register(page);

  await page.click('[data-testid="user-avatar"]');
  await expect(page.locator('[data-testid="user-menu"]')).toBeVisible();
  await page.click('[data-testid="logout-button"]');
  await page.waitForURL("**/login");
  await expect(page.locator('[data-testid="login-form"]')).toBeVisible();
});
