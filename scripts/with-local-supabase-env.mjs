#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const command = process.argv[2];
const args = process.argv.slice(3);

if (!command) {
  console.error(
    "Usage: node scripts/with-local-supabase-env.mjs <command> [args...]"
  );
  process.exit(2);
}

function flatten(value, prefix = "", out = new Map()) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }
  out.set(prefix, String(value ?? ""));
  return out;
}

function findValue(flat, exactPaths, fallbackPattern) {
  for (const path of exactPaths) {
    const value = flat.get(path);
    if (value) return value;
  }
  for (const [path, value] of flat.entries()) {
    if (fallbackPattern.test(path) && value) return value;
  }
  return "";
}

const status = spawnSync("supabase", ["status", "-o", "json"], {
  cwd: repoRoot,
  encoding: "utf8",
});

if (status.status !== 0) {
  console.error(status.stderr || status.stdout);
  console.error(
    "Local Supabase is not running. Start it with `pnpm db:local:start`, then run this command again."
  );
  process.exit(status.status ?? 1);
}

let parsed;
try {
  parsed = JSON.parse(status.stdout);
} catch (err) {
  console.error("Could not parse `supabase status -o json` output.");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const flat = flatten(parsed);
const supabaseUrl = findValue(flat, ["api.url", "API_URL"], /(^|\.)api(_|\.)?url$/i);
const anonKey = findValue(
  flat,
  ["auth.anon_key", "auth.anonKey", "ANON_KEY"],
  /(^|\.)(anon|anon_key|anonKey)$/i
);
const serviceRoleKey = findValue(
  flat,
  ["auth.service_role_key", "auth.serviceRoleKey", "SERVICE_ROLE_KEY"],
  /(^|\.)(service_role|service_role_key|serviceRoleKey)$/i
);

const missing = [];
if (!supabaseUrl) missing.push("api.url");
if (!anonKey) missing.push("auth.anon_key");
if (!serviceRoleKey) missing.push("auth.service_role_key");

if (missing.length > 0) {
  console.error(`Supabase status is missing required local values: ${missing.join(", ")}`);
  console.error("Run `pnpm db:local:status` to inspect the local stack output.");
  process.exit(1);
}

const env = {
  ...process.env,
  AUTH_MODE: "local",
  DB_BACKEND: "supabase",
  POPCORN_E2E_ENV_FILE:
    process.env.POPCORN_E2E_ENV_FILE ?? "apps/web/e2e/e2e.local-db.env",
  POPCORN_E2E_AUTH_MODE: "local",
  STORAGE_BACKEND: process.env.STORAGE_BACKEND ?? "local",
  SUPABASE_URL: supabaseUrl,
  SUPABASE_ANON_KEY: anonKey,
  SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  VITE_SUPABASE_ENV: "default",
  VITE_SUPABASE_URL: supabaseUrl,
  VITE_SUPABASE_ANON_KEY: anonKey,
};

const result = spawnSync(command, args, {
  cwd: repoRoot,
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
