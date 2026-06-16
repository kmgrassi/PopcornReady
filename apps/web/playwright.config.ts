import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_WEB_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: [
      "VITE_SUPABASE_ENV=",
      "VITE_SUPABASE_URL=",
      "VITE_SUPABASE_ANON_KEY=",
      "VITE_SUPABASE_DEV_URL=",
      "VITE_SUPABASE_DEV_ANON_KEY=",
      "VITE_SUPABASE_PROD_URL=",
      "VITE_SUPABASE_PROD_ANON_KEY=",
      `pnpm dev --host 127.0.0.1 --port ${port} --strictPort`,
    ].join(" "),
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
