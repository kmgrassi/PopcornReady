import { resolveBrowserSupabaseConfig } from "./browser";

const TOKEN_BYTES = 32;

function storageKey(): string {
  const config = resolveBrowserSupabaseConfig();
  if (!config) return "popcornready.anonymousDeviceRecovery.default";

  let host = "unknown";
  try {
    host = new URL(config.url).host.toLowerCase();
  } catch {
    host = config.url.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 48);
  }

  return `popcornready.anonymousDeviceRecovery.${config.envName}.${host}`;
}

function randomToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function getAnonymousDeviceRecoveryToken(): string | null {
  try {
    return window.localStorage.getItem(storageKey());
  } catch {
    return null;
  }
}

export function ensureAnonymousDeviceRecoveryToken(): string {
  const existing = getAnonymousDeviceRecoveryToken();
  if (existing) return existing;

  const token = randomToken();
  try {
    window.localStorage.setItem(storageKey(), token);
  } catch {
    // If localStorage is blocked, keep a token for this page lifecycle. Supabase
    // auth persistence is likely blocked too, so recovery across visits cannot
    // be guaranteed in that browser context.
  }
  return token;
}

export function clearAnonymousDeviceRecoveryToken() {
  try {
    window.localStorage.removeItem(storageKey());
  } catch {
    // Ignore storage access failures.
  }
}
