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

const webPort = Number(
  e2eEnv.PLAYWRIGHT_WEB_PORT ?? e2eEnv.POPCORN_E2E_WEB_PORT ?? 3100,
);
const authMode = (
  e2eEnv.POPCORN_E2E_AUTH_MODE ??
  e2eEnv.AUTH_MODE ??
  "local"
).toLowerCase();
const hostedAuthMode = authMode === "supabase";
const apiPort = Number(
  e2eEnv.POPCORN_E2E_API_PORT ?? e2eEnv.PLAYWRIGHT_API_PORT ?? e2eEnv.PORT ?? 4100,
);
const baseURL = e2eEnv.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${webPort}`;
const apiURL = e2eEnv.VITE_API_URL || `http://127.0.0.1:${apiPort}`;
const { VITE_API_URL: _clientApiURL, ...webE2EEnv } = e2eEnv;

process.env.POPCORN_E2E_AUTH_MODE = authMode;
process.env.POPCORN_E2E_API_PORT = String(apiPort);
process.env.VITE_API_URL = apiURL;

const apiServerEnv = {
  ...e2eEnv,
  AUTH_MODE: authMode,
  PORT: String(apiPort),
  VITE_API_URL: apiURL,
};

const webServerEnv = hostedAuthMode
  ? {
      ...e2eEnv,
      AUTH_MODE: authMode,
      PLAYWRIGHT_BASE_URL: baseURL,
      PLAYWRIGHT_API_PORT: String(apiPort),
      VITE_API_URL: apiURL,
    }
  : {
      ...webE2EEnv,
      AUTH_MODE: authMode,
      PLAYWRIGHT_BASE_URL: baseURL,
      PLAYWRIGHT_API_PORT: String(apiPort),
    };

const webCommand = hostedAuthMode
  ? `pnpm --filter @popcorn/web exec vite build && pnpm --filter @popcorn/web exec vite preview --host 127.0.0.1 --port ${webPort} --strictPort`
  : `pnpm --filter @popcorn/web exec vite --host 127.0.0.1 --port ${webPort} --strictPort`;

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
      env: apiServerEnv,
      url: `${apiURL}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: webCommand,
      cwd: repoRoot,
      env: webServerEnv,
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
