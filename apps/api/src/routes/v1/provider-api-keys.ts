import { Router } from "express";
import { mutation, route } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import {
  encryptProviderApiKey,
  providerApiKeyHint,
  readModelProvider,
  type ModelProvider,
} from "@/lib/provider-api-keys";
import {
  getCurrentAppUserId,
  getRequestSupabase,
} from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";

export const providerApiKeysRouter = Router();

interface ProviderApiKeyRow {
  provider: ModelProvider;
  key_hint: string;
  updated_at: string;
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
  route(async () => {
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
  mutation(async ({ body }, params) => {
    const provider = readModelProvider(params.provider);
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
            key_ciphertext: encryptProviderApiKey(apiKey),
            key_hint: providerApiKeyHint(apiKey),
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
  mutation(async (_ctx, params) => {
    const provider = readModelProvider(params.provider);
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
