// Resolve which API key a provider call should use: the acting user's own key
// (bring-your-own) when present, else the platform's env key.
//
// Why a context instead of threading a key through every call: generation runs
// both in-request (e.g. regenerate) AND in detached orchestrator runs that
// resume from workers with no request context. So the acting user is resolved
// from, in order:
//   1. an explicit run-scoped context the engine sets from the run's workspace owner
//   2. the per-request context (requestContext.publicUserId) for in-request gen
//   3. nothing → fall back to the platform env key (today's behavior)
//
// BYO is a hosted-auth feature: local/guest runs have no user, so they keep
// using the platform keys. Phase 2 (credits) reads the resolved `source` to
// decide whether a generation should be billed.

import { AsyncLocalStorage } from "node:async_hooks";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { requestContext } from "@/lib/supabase/request-context";
import { decryptApiKey } from "./crypto";
import { rootLogger } from "@/lib/v1/logger";

// The user-key providers (matches the public.model_provider enum + the
// provider-api-keys route). Each generative provider file passes its own value.
export type KeyProvider =
  | "openai"
  | "anthropic"
  | "gemini"
  | "ideogram"
  | "elevenlabs"
  | "runway"
  | "ltx"
  | "kling"
  | "seedance"
  | "xai"
  | "nvidia";

// Platform fallback env var per provider. Mirrors what each provider read before.
const PLATFORM_ENV: Record<KeyProvider, () => string | undefined> = {
  openai: () => process.env.OPENAI_API_KEY,
  anthropic: () => process.env.ANTHROPIC_API_KEY,
  gemini: () => process.env.GEMINI_API_KEY,
  ideogram: () => process.env.IDEOGRAM_API_KEY,
  elevenlabs: () => process.env.ELEVENLABS_API_KEY,
  runway: () => process.env.RUNWAYML_API_SECRET || process.env.RUNWAY_API_KEY,
  ltx: () => process.env.LTX_API_KEY,
  kling: () => process.env.KLING_API_KEY,
  seedance: () => process.env.FAL_KEY || process.env.SEEDANCE_API_KEY,
  xai: () => process.env.XAI_API_KEY,
  nvidia: () => process.env.NVIDIA_API_KEY,
};

interface ProviderKeyContext {
  /** The acting user's public.users.id, or null for guest/local runs. */
  userId: string | null;
  /**
   * The key source last resolved per provider this run. A run uses one key per
   * provider, so this is how a later generation knows whether its provider ran
   * on the user's own key (free) or the platform's (billable).
   */
  providerSource: Partial<Record<KeyProvider, KeySource>>;
  /** Running tally of provider cost incurred on PLATFORM keys (USD) — the billable amount. */
  billing: { platformUsd: number };
}

const providerKeyContext = new AsyncLocalStorage<ProviderKeyContext>();

// Run a function with an explicit acting user for key resolution. The engine
// wraps each (initial + resumed) orchestrator run in this so detached runs still
// resolve the owner's BYO keys, and so the billable-cost tally is run-scoped.
export function withProviderKeyUser<T>(
  userId: string | null,
  fn: () => Promise<T>
): Promise<T> {
  return providerKeyContext.run(
    { userId, providerSource: {}, billing: { platformUsd: 0 } },
    fn
  );
}

// Total provider cost charged to platform keys so far in the current run (USD).
// The engine snapshots this around each tool to debit only the billable delta.
export function billableUsdSoFar(): number {
  return providerKeyContext.getStore()?.billing.platformUsd ?? 0;
}

// The acting user of the current run context (null if none / in-request).
export function currentRunUserId(): string | null {
  return providerKeyContext.getStore()?.userId ?? null;
}

// Record a completed generation's cost against billing. No-op unless the
// provider ran on a platform key in a run-scoped context (BYO + in-request +
// local all skip billing). Providers call this once where they compute costUsd.
export function noteBillableGeneration(provider: KeyProvider, costUsd: number): void {
  const ctx = providerKeyContext.getStore();
  if (!ctx || !(costUsd > 0)) return;
  if (ctx.providerSource[provider] === "platform") {
    ctx.billing.platformUsd += costUsd;
  }
}

// The owning user of a workspace (public.users.id), or null for a guest/throwaway
// workspace. Orchestrator runs are workspace-scoped, so the engine maps the run's
// workspace to its owner to resolve that user's BYO keys.
export async function getWorkspaceOwnerUserId(
  workspaceId: string
): Promise<string | null> {
  const { data, error } = await getServiceSupabase()
    .from("workspaces")
    .select("owner_id")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { owner_id: string | null }).owner_id ?? null;
}

// Whether a user has stored at least one BYO provider key. Used by the credit
// pre-check to avoid false-blocking a user who funds generation with their own
// keys (their platform spend, if any, is still caught by the post-gen debit).
export async function userHasAnyProviderKey(userId: string): Promise<boolean> {
  const { count, error } = await getServiceSupabase()
    .from("provider_api_keys")
    .select("provider", { count: "exact", head: true })
    .eq("user_id", userId);
  if (error) return false;
  return (count ?? 0) > 0;
}

function actingUserId(): string | null {
  const explicit = providerKeyContext.getStore();
  if (explicit) return explicit.userId;
  return requestContext.getStore()?.publicUserId ?? null;
}

export type KeySource = "user" | "platform";

export interface ResolvedProviderKey {
  apiKey: string | undefined;
  source: KeySource;
}

// Resolve a usable key + whether it's the user's own or the platform's. Returns
// `apiKey: undefined` only when neither a user key nor a platform env key exists
// (the provider then raises its existing "key is not set" error).
export async function resolveProviderKey(
  provider: KeyProvider
): Promise<ResolvedProviderKey> {
  const resolved = await resolveProviderKeyInner(provider);
  // Remember the source so noteBillableGeneration can attribute this provider's
  // cost to user (free) vs platform (billable) without re-resolving.
  const ctx = providerKeyContext.getStore();
  if (ctx) ctx.providerSource[provider] = resolved.source;
  return resolved;
}

async function resolveProviderKeyInner(
  provider: KeyProvider
): Promise<ResolvedProviderKey> {
  const userId = actingUserId();
  if (userId) {
    const userKey = await loadUserKey(userId, provider);
    if (userKey) return { apiKey: userKey, source: "user" };
  }
  return { apiKey: PLATFORM_ENV[provider]?.(), source: "platform" };
}

// Convenience for provider call sites that only need the key string.
export async function resolveProviderApiKey(
  provider: KeyProvider
): Promise<string | undefined> {
  return (await resolveProviderKey(provider)).apiKey;
}

async function loadUserKey(
  userId: string,
  provider: KeyProvider
): Promise<string | null> {
  const { data, error } = await getServiceSupabase()
    .from("provider_api_keys")
    .select("key_ciphertext")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  if (error || !data) return null;
  try {
    return decryptApiKey((data as { key_ciphertext: string }).key_ciphertext);
  } catch (err) {
    // A bad ciphertext must not break generation — log and fall back to platform.
    rootLogger.error("provider_key_decrypt_failed", {
      provider,
      error: { message: err instanceof Error ? err.message : String(err) },
    });
    return null;
  }
}
