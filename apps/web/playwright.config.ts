import { defineConfig, devices } from "@playwright/test";

const webPort = Number(
  process.env.PLAYWRIGHT_WEB_PORT ?? process.env.POPCORN_E2E_WEB_PORT ?? 3100,
);
const apiPort = Number(process.env.POPCORN_E2E_API_PORT ?? 4180);
const authMode = (process.env.POPCORN_E2E_AUTH_MODE ?? "local").toLowerCase();
const hostedAuthMode = authMode === "supabase";
const apiOrigin = process.env.VITE_API_URL ?? `http://127.0.0.1:${apiPort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;

const baseServerEnv = {
  NODE_ENV: "development",
  AUTH_MODE: authMode,
  PORT: String(apiPort),
  WEB_ORIGIN: webOrigin,
  VITE_API_URL: apiOrigin,
  VITE_SUPABASE_ENV: process.env.VITE_SUPABASE_ENV ?? "default",
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? "",
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY ?? "",
  VITE_SUPABASE_DEV_URL: process.env.VITE_SUPABASE_DEV_URL ?? "",
  VITE_SUPABASE_DEV_ANON_KEY: process.env.VITE_SUPABASE_DEV_ANON_KEY ?? "",
  VITE_SUPABASE_PROD_URL: process.env.VITE_SUPABASE_PROD_URL ?? "",
  VITE_SUPABASE_PROD_ANON_KEY: process.env.VITE_SUPABASE_PROD_ANON_KEY ?? "",
};

const webCommand = hostedAuthMode
  ? `pnpm --dir apps/web exec vite build && pnpm --dir apps/web exec vite preview --host 127.0.0.1 --port ${webPort} --strictPort`
  : `pnpm --dir apps/web exec vite --host 127.0.0.1 --port ${webPort} --strictPort`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: webOrigin,
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "pnpm --filter @popcorn/api start",
      cwd: "../..",
      url: `http://127.0.0.1:${apiPort}/api/v1/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: baseServerEnv,
    },
    {
      command: webCommand,
      cwd: "../..",
      url: webOrigin,
      timeout: 120_000,
      reuseExistingServer: false,
      env: baseServerEnv,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
