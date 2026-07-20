import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://localhost:3100/conveneai",
    headless: true,
  },
  webServer: {
    command: "npx next dev --port 3100",
    url: "http://localhost:3100/conveneai/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
