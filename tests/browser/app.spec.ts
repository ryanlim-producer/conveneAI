import { test, expect, type Page } from "@playwright/test";
import path from "path";

// Each run registers a fresh account in the dev DB.
const EMAIL = `e2e-${Date.now()}@example.com`;
const PASSWORD = "playwright-secret-1";

const FIXTURE_MP3 = path.join(__dirname, "fixtures", "meeting.mp3");

async function register(page: Page, email = EMAIL, password = PASSWORD) {
  await page.goto("/register");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('[data-testid="register-form"] button[type="submit"]');
  await page.waitForURL("**/");
}

async function login(page: Page, email = EMAIL, password = PASSWORD) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('[data-testid="login-form"] button[type="submit"]');
  await page.waitForURL("**/");
}

test.describe.configure({ mode: "serial" });

test("unauthenticated visitors are redirected to /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator('[data-testid="login-form"]')).toBeVisible();
});

test("register creates an account and lands on the recordings page", async ({ page }) => {
  await register(page);
  await expect(page.locator('[data-testid="user-nav"]')).toBeVisible();
  await expect(page.getByText("No recordings yet")).toBeVisible();
});

test("login rejects a wrong password with a visible error", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", EMAIL);
  await page.fill("#password", "totally-wrong-pw");
  await page.click('[data-testid="login-form"] button[type="submit"]');
  await expect(page.locator('[data-testid="auth-error"]')).toContainText(/invalid/i);
});

test("login works and logout returns to the login page", async ({ page }) => {
  await login(page);
  await expect(page.locator('[data-testid="user-nav"]')).toBeVisible();
  await page.click('[data-testid="logout-button"]');
  await page.waitForURL("**/login**");
  // session actually destroyed: going home redirects back to login
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
});

test("upload page shows the drag-and-drop zone and language picker", async ({ page }) => {
  await login(page);
  await page.goto("/upload");
  await expect(page.locator('[data-testid="upload-dropzone"]')).toBeVisible();
  await expect(page.locator('[data-testid="language-select"]')).toHaveValue("es");
  await expect(page.locator('[data-testid="upload-submit"]')).toBeDisabled();
});

test("queue page shows the empty state for a fresh account", async ({ page }) => {
  await login(page);
  await page.goto("/queue");
  await expect(page.locator('[data-testid="queue-empty"]')).toBeVisible();
});

test("settings shows recommended defaults and persists a model change", async ({ page }) => {
  await login(page);
  await page.goto("/settings");

  const deepgramPicker = page.locator('[data-testid="model-picker-deepgram-model"]');
  await expect(deepgramPicker).toHaveValue("nova-3");
  await expect(deepgramPicker.locator("option", { hasText: "Recommended" }).first()).toHaveText(
    /Nova-3/,
  );

  await expect(page.locator('[data-testid="model-picker-chatbot-model"]')).toHaveValue(
    "deepseek/deepseek-r1",
  );

  await deepgramPicker.selectOption("nova-2-meeting");
  await page.click('[data-testid="save-models"]');
  await expect(page.getByText("Model preferences saved")).toBeVisible();

  await page.reload();
  await expect(page.locator('[data-testid="model-picker-deepgram-model"]')).toHaveValue(
    "nova-2-meeting",
  );
  // restore the recommended default for the pipeline E2E below
  await page.locator('[data-testid="model-picker-deepgram-model"]').selectOption("nova-3");
  await page.click('[data-testid="save-models"]');
  await expect(page.getByText("Model preferences saved")).toBeVisible();
});

test("full pipeline: upload real audio → queue → done → chat about the meeting", async ({
  page,
}) => {
  test.setTimeout(300_000); // real Deepgram + LLM calls

  await login(page);
  await page.goto("/upload");
  await page.locator('[data-testid="upload-input"]').setInputFiles(FIXTURE_MP3);
  await page.locator('[data-testid="language-select"]').selectOption("en");
  await page.click('[data-testid="upload-submit"]');

  // lands on the queue with the job visible
  await page.waitForURL("**/queue");
  await expect(page.locator('[data-testid="queue-list"]')).toBeVisible();
  await expect(page.getByText("meeting.mp3").first()).toBeVisible();

  // live status reaches Done (SSE or polling)
  await expect(page.locator('[data-testid="job-status"]').first()).toHaveText(/Done/, {
    timeout: 240_000,
  });

  // recording appears in history with action items
  await page.goto("/");
  const link = page.locator('[data-testid^="recording-link-"]').first();
  await expect(link).toBeVisible();
  await link.click();

  // chat-first workspace: sidebar + chat tab by default
  await expect(page.locator('[data-testid="recording-workspace"]')).toBeVisible();
  await expect(page.locator('[data-testid="action-items-sidebar"]')).toBeVisible();
  await expect(page.locator('[data-testid="chat-window"]')).toBeVisible();
  await expect(page.locator('[data-testid="audio-player"]')).toBeVisible();

  // transcript tab shows speaker-labelled content
  await page.click('[data-testid="tab-transcript"]');
  await expect(page.locator('[data-testid="transcript-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="transcript-segment"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="transcript-panel"]')).toContainText(/budget/i);

  // ask the chatbot a grounded question
  await page.click('[data-testid="tab-chat"]');
  await page.fill('[data-testid="chat-input"]', "What should Mark send, and by when?");
  await page.click('[data-testid="chat-send"]');
  const reply = page.locator('[data-testid="chat-message-assistant"]').first();
  await expect(reply).toBeVisible({ timeout: 120_000 });
  await expect(reply).toContainText(/report|friday/i);

  // history persists across reload
  await page.reload();
  await expect(page.locator('[data-testid="chat-message-user"]').first()).toContainText("Mark");
});
