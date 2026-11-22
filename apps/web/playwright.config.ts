import { defineConfig } from "@playwright/test";

// Run against a stack that is already up: local Supabase, `pnpm dev` (web app
// and worker), and the converter image. See docs/LOCAL_DEVELOPMENT.md.
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // Every test makes its own accounts, but one at a time keeps clear of the
  // local sign-in rate limits.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    // The installed Chrome, so no separate browser download is needed.
    channel: process.env.E2E_BROWSER_CHANNEL ?? "chrome",
    trace: "retain-on-failure",
  },
});
