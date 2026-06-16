import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 3100);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
  },
  webServer: {
    command: [
      "VITE_SUPABASE_URL=",
      "VITE_SUPABASE_ANON_KEY=",
      "VITE_SUPABASE_DEV_URL=",
      "VITE_SUPABASE_DEV_ANON_KEY=",
      `pnpm --filter @popcorn/web dev -- --host 127.0.0.1 --port ${port}`,
    ].join(" "),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
