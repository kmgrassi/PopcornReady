import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  encryptProviderApiKey,
  runtimeProviderApiKey,
} from "./provider-api-keys";
import { requestContext } from "./supabase/request-context";

async function withEnv<T>(
  updates: Record<string, string | undefined>,
  fn: () => Promise<T>
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(updates)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function fakeSupabase(ciphertext: string): SupabaseClient {
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    maybeSingle() {
      return Promise.resolve({
        data: { key_ciphertext: ciphertext },
        error: null,
      });
    },
  };
  return {
    from(table: string) {
      assert.equal(table, "provider_api_keys");
      return query;
    },
  } as unknown as SupabaseClient;
}

test("runtimeProviderApiKey prefers the current request's stored key", async () => {
  await withEnv(
    {
      PROVIDER_API_KEYS_ENCRYPTION_SECRET: "test-secret",
      OPENAI_API_KEY: "env-openai-key",
    },
    async () => {
      const ciphertext = encryptProviderApiKey("stored-openai-key");
      const value = await requestContext.run(
        {
          supabase: fakeSupabase(ciphertext),
          publicUserId: "user_1",
          email: null,
          isAnonymous: false,
        },
        () => runtimeProviderApiKey("openai")
      );
      assert.equal(value, "stored-openai-key");
    }
  );
});

test("runtimeProviderApiKey falls back to environment keys without request context", async () => {
  await withEnv(
    {
      PROVIDER_API_KEYS_ENCRYPTION_SECRET: "test-secret",
      RUNWAYML_API_SECRET: "env-runway-key",
      RUNWAY_API_KEY: undefined,
    },
    async () => {
      assert.equal(await runtimeProviderApiKey("runway"), "env-runway-key");
    }
  );
});
