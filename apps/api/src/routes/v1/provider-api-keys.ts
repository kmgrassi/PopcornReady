import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import { mutation, route } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import {
  getCurrentAppUserId,
  getRequestSupabase,
} from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";

export const providerApiKeysRouter = Router();

const PROVIDERS = [
  "openai",
  "anthropic",
  "gemini",
  "ideogram",
  "elevenlabs",
  "runway",
  "ltx",
  "nvidia",
] as const;

type Provider = (typeof PROVIDERS)[number];

interface ProviderApiKeyRow {
  provider: Provider;
  key_hint: string;
  updated_at: string;
}

function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value);
}

function readProvider(value: unknown): Provider {
  const provider = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!isProvider(provider)) {
    throw new ApiError("validation_failed", "Choose a supported model provider.");
  }
  return provider;
}

function readBodyObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("validation_failed", "Request body must be an object.");
  }
  return body as Record<string, unknown>;
}

function readKey(body: Record<string, unknown>): string {
  const key = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (key.length < 8) {
    throw new ApiError("validation_failed", "Enter an API key with at least 8 characters.");
  }
  if (key.length > 4096) {
    throw new ApiError("validation_failed", "API keys must be 4096 characters or fewer.");
  }
  return key;
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

function encryptApiKey(apiKey: string): string {
  const key = createHash("sha256").update(encryptionSecret()).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(apiKey, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString(
    "base64url"
  )}`;
}

function keyHint(apiKey: string): string {
  if (apiKey.length <= 8) return "••••";
  return `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}`;
}

function toProviderApiKey(row: ProviderApiKeyRow) {
  return {
    provider: row.provider,
    hasKey: true,
    keyHint: row.key_hint,
    updatedAt: row.updated_at,
  };
}

providerApiKeysRouter.get(
  "/provider-api-keys",
  route(async ({ auth }) => {
    if (auth.isLocal) {
      return {
        status: 200,
        body: { keys: [] },
      };
    }

    const rows = await runQuery(
      "providerApiKeys.list",
      getRequestSupabase()
        .from("provider_api_keys")
        .select("provider,key_hint,updated_at")
        .order("provider", { ascending: true })
    );

    return {
      status: 200,
      body: {
        keys: (rows as ProviderApiKeyRow[]).map(toProviderApiKey),
      },
    };
  })
);

providerApiKeysRouter.put(
  "/provider-api-keys/:provider",
  mutation(async ({ auth, body }, params) => {
    if (auth.isLocal) {
      throw new ApiError("unauthorized", "Sign in to manage provider API keys.");
    }

    const provider = readProvider(params.provider);
    const apiKey = readKey(readBodyObject(body));
    const userId = await getCurrentAppUserId();

    const row = await runQuery(
      "providerApiKeys.upsert",
      getRequestSupabase()
        .from("provider_api_keys")
        .upsert(
          {
            user_id: userId,
            provider,
            key_ciphertext: encryptApiKey(apiKey),
            key_hint: keyHint(apiKey),
          },
          { onConflict: "user_id,provider" }
        )
        .select("provider,key_hint,updated_at")
        .single()
    );

    return {
      status: 200,
      body: { key: toProviderApiKey(row as ProviderApiKeyRow) },
    };
  })
);

providerApiKeysRouter.delete(
  "/provider-api-keys/:provider",
  mutation(async ({ auth }, params) => {
    if (auth.isLocal) {
      throw new ApiError("unauthorized", "Sign in to manage provider API keys.");
    }

    const provider = readProvider(params.provider);
    await runQuery(
      "providerApiKeys.delete",
      getRequestSupabase()
        .from("provider_api_keys")
        .delete()
        .eq("provider", provider)
        .select("provider")
    );

    return {
      status: 200,
      body: { ok: true },
    };
  })
);
