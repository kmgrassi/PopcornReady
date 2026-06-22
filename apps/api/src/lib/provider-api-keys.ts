import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { ApiError } from "@/core/errors";
import { runQuery } from "@/lib/supabase/db-errors";
import { requestContext } from "@/lib/supabase/request-context";

export const MODEL_PROVIDERS = [
  "openai",
  "anthropic",
  "gemini",
  "elevenlabs",
  "runway",
  "ltx",
  "nvidia",
] as const;

export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

interface ProviderApiKeySecretRow {
  key_ciphertext: string;
}

const ENV_KEYS: Record<ModelProvider, string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  gemini: ["GEMINI_API_KEY"],
  elevenlabs: ["ELEVENLABS_API_KEY"],
  runway: ["RUNWAYML_API_SECRET", "RUNWAY_API_KEY"],
  ltx: ["LTX_API_KEY"],
  nvidia: ["NVIDIA_API_KEY"],
};

export function isModelProvider(value: string): value is ModelProvider {
  return (MODEL_PROVIDERS as readonly string[]).includes(value);
}

export function readModelProvider(value: unknown): ModelProvider {
  const provider = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!isModelProvider(provider)) {
    throw new ApiError("validation_failed", "Choose a supported model provider.");
  }
  return provider;
}

function encryptionSecret(): string {
  const secret =
    process.env.PROVIDER_API_KEYS_ENCRYPTION_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) {
    throw new ApiError(
      "not_implemented",
      "Provider key storage needs PROVIDER_API_KEYS_ENCRYPTION_SECRET or SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  return secret;
}

function encryptionKey(): Buffer {
  return createHash("sha256").update(encryptionSecret()).digest();
}

export function encryptProviderApiKey(apiKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(apiKey, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString(
    "base64url"
  )}`;
}

export function decryptProviderApiKey(ciphertext: string): string {
  const [version, iv, tag, value] = ciphertext.split(".");
  if (version !== "v1" || !iv || !tag || !value) {
    throw new ApiError("internal_error", "Provider key ciphertext is invalid.");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(value, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function providerApiKeyHint(apiKey: string): string {
  if (apiKey.length <= 8) return "••••";
  return `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}`;
}

function envProviderApiKey(provider: ModelProvider): string | null {
  for (const name of ENV_KEYS[provider]) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

async function storedProviderApiKey(provider: ModelProvider): Promise<string | null> {
  const ctx = requestContext.getStore();
  if (!ctx) return null;

  ctx.providerApiKeys ??= new Map();
  if (ctx.providerApiKeys.has(provider)) {
    return ctx.providerApiKeys.get(provider) ?? null;
  }

  const row = await runQuery(
    "providerApiKeys.runtimeRead",
    ctx.supabase
      .from("provider_api_keys")
      .select("key_ciphertext")
      .eq("provider", provider)
      .maybeSingle(),
    { allowMissing: true }
  );
  const apiKey = row
    ? decryptProviderApiKey((row as ProviderApiKeySecretRow).key_ciphertext)
    : null;
  ctx.providerApiKeys.set(provider, apiKey);
  return apiKey;
}

export async function runtimeProviderApiKey(
  provider: ModelProvider
): Promise<string | null> {
  return (await storedProviderApiKey(provider)) ?? envProviderApiKey(provider);
}

export async function hasRuntimeProviderApiKey(
  provider: ModelProvider
): Promise<boolean> {
  return Boolean(await runtimeProviderApiKey(provider));
}
