import { chromium, webkit } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3100";
const FILE = process.env.FILE!;

async function main() {
  const browser = await (process.env.ENGINE === "webkit" ? webkit : chromium).launch();
  const page = await browser.newPage();

  const email = `m4a-repro-${Date.now()}@example.com`;
  await page.goto(`${BASE}/register`);
  await page.fill("#email", email);
  await page.fill("#password", "repro-password-1");
  await page.click('[data-testid="register-form"] button[type="submit"]');
  await page.waitForURL("**/");

  await page.goto(`${BASE}/upload`);

  // capture the exact response of the upload POST
  const responsePromise = page.waitForResponse((r) => r.url().includes("/api/upload"), { timeout: 60000 });

  await page.locator('[data-testid="upload-input"]').setInputFiles(FILE);
  await page.click('[data-testid="upload-submit"]');

  const res = await responsePromise.catch(() => null);
  if (res) {
    console.log("UPLOAD RESPONSE:", res.status(), await res.text());
  } else {
    console.log("NO UPLOAD RESPONSE (client-side rejection?)");
    const toast = await page.locator("[data-sonner-toast]").textContent().catch(() => "(no toast)");
    console.log("TOAST:", toast);
  }
  await browser.close();
}

main().catch((e) => {
  console.error("REPRO FAILED:", e.message);
  process.exit(1);
});
