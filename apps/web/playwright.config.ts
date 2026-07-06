import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const webRoot = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(webRoot, "../..");
const envFile = process.env.POPCORN_E2E_ENV_FILE
  ? path.resolve(repoRoot, process.env.POPCORN_E2E_ENV_FILE)
  : path.join(webRoot, "e2e", "e2e.env");

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
function hasRequestedProject(name: string): boolean {
  return process.argv.some((arg, index, args) => {
    if (arg === "--project" || arg === "-p") return args[index + 1] === name;
    return arg === `--project=${name}` || arg === `-p=${name}`;
  });
}

const includePwaProject =
  hasRequestedProject("pwa") || e2eEnv.POPCORN_E2E_INCLUDE_PWA === "true";
const apiPort = Number(
  e2eEnv.POPCORN_E2E_API_PORT ?? e2eEnv.PLAYWRIGHT_API_PORT ?? e2eEnv.PORT ?? 4100,
);
const webPortOverridden = Boolean(
  process.env.PLAYWRIGHT_WEB_PORT || process.env.POPCORN_E2E_WEB_PORT,
);
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ||
  (!webPortOverridden && e2eEnv.PLAYWRIGHT_BASE_URL) ||
  `http://127.0.0.1:${webPort}`;
const apiURL = e2eEnv.VITE_API_URL || `http://127.0.0.1:${apiPort}`;
const reuseExistingServer =
  e2eEnv.POPCORN_E2E_REUSE_EXISTING_SERVER === "false" ? false : !process.env.CI;
const { VITE_API_URL: _clientApiURL, ...webE2EEnv } = e2eEnv;
const browserAuthDisabledEnv = {
  VITE_SUPABASE_ENV: "",
  VITE_SUPABASE_URL: "",
  VITE_SUPABASE_ANON_KEY: "",
  VITE_SUPABASE_DEV_URL: "",
  VITE_SUPABASE_DEV_ANON_KEY: "",
  VITE_SUPABASE_PROD_URL: "",
  VITE_SUPABASE_PROD_ANON_KEY: "",
};

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
      ...browserAuthDisabledEnv,
      AUTH_MODE: authMode,
      PLAYWRIGHT_BASE_URL: baseURL,
      PLAYWRIGHT_API_PORT: String(apiPort),
    };
const pwaWebServerEnv = {
  ...webServerEnv,
  NODE_ENV: "production",
};

const usePwaWebServer = includePwaProject && !hostedAuthMode;
const usePreviewWebServer = hostedAuthMode || includePwaProject;
const webCommand = usePwaWebServer
  ? `pnpm --filter @popcorn/web exec tsc --noEmit && pnpm --filter @popcorn/web exec vite build && pnpm --filter @popcorn/web exec vite preview --host 127.0.0.1 --port ${webPort} --strictPort`
  : usePreviewWebServer
  ? `pnpm --filter @popcorn/web exec vite build && pnpm --filter @popcorn/web exec vite preview --host 127.0.0.1 --port ${webPort} --strictPort`
  : `pnpm --filter @popcorn/web exec vite --host 127.0.0.1 --port ${webPort} --strictPort`;
const mobileCriticalGrep = /@mobile/;

const apiWebServer = {
  command: "pnpm --filter @popcorn/api start",
  cwd: repoRoot,
  env: apiServerEnv,
  url: `${apiURL}/api/v1/health`,
  reuseExistingServer,
  timeout: 120_000,
};

const appWebServer = {
  command: webCommand,
  cwd: repoRoot,
  env: usePwaWebServer ? pwaWebServerEnv : webServerEnv,
  url: baseURL,
  reuseExistingServer: false,
  timeout: 120_000,
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
  webServer: usePwaWebServer ? [appWebServer] : [apiWebServer, appWebServer],
  projects: [
    {
      name: "chromium",
      testIgnore: /pwa\/.+\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-safari",
      grep: mobileCriticalGrep,
      testIgnore: /pwa\/.+\.spec\.ts/,
      use: { ...devices["iPhone 13"] },
    },
    {
      name: "mobile-chrome",
      grep: mobileCriticalGrep,
      testIgnore: /pwa\/.+\.spec\.ts/,
      use: { ...devices["Pixel 7"] },
    },
    ...(includePwaProject
      ? [
          {
            name: "pwa",
            testMatch: /pwa\/.+\.spec\.ts/,
            use: { ...devices["Desktop Chrome"] },
          },
        ]
      : []),
  ],
});
