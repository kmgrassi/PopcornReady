import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const webRoot = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(webRoot, "../..");
const envFile = path.join(webRoot, "e2e", "e2e.env");

function readEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    env[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return env;
}

const e2eEnv = {
  ...readEnvFile(envFile),
  ...process.env,
};

const webPort = Number(e2eEnv.PLAYWRIGHT_WEB_PORT ?? 3100);
const baseURL = e2eEnv.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${webPort}`;
const apiURL = e2eEnv.VITE_API_URL || `http://127.0.0.1:${e2eEnv.PLAYWRIGHT_API_PORT ?? 4100}`;
const browserAuthDisabledEnv = {
  VITE_SUPABASE_ENV: "",
  VITE_SUPABASE_URL: "",
  VITE_SUPABASE_ANON_KEY: "",
  VITE_SUPABASE_DEV_URL: "",
  VITE_SUPABASE_DEV_ANON_KEY: "",
  VITE_SUPABASE_PROD_URL: "",
  VITE_SUPABASE_PROD_ANON_KEY: "",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: "pnpm --filter @popcorn/api start",
      cwd: repoRoot,
      env: {
        ...e2eEnv,
        VITE_API_URL: apiURL,
      },
      url: `${apiURL}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @popcorn/web exec vite --host 127.0.0.1 --port ${webPort} --strictPort`,
      cwd: repoRoot,
      env: {
        ...e2eEnv,
        ...browserAuthDisabledEnv,
        PLAYWRIGHT_BASE_URL: baseURL,
        VITE_API_URL: apiURL,
      },
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
