import { AsyncLocalStorage } from "node:async_hooks";

import type { LlmProvider } from "./types";

export interface LlmUsage {
  provider: LlmProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from a provider prompt cache. */
  cacheReadInputTokens?: number;
  /** Tokens written into a provider prompt cache. */
  cacheCreationInputTokens?: number;
}

export type LlmUsageObserver = (usage: LlmUsage) => void | Promise<void>;

const usageObserverContext = new AsyncLocalStorage<LlmUsageObserver>();

/**
 * Scopes provider-usage observation to one asynchronous product operation.
 * The LLM package stays persistence-agnostic; callers decide how to store the
 * provider result and may deliberately omit a scope for non-product work.
 */
export function withLlmUsageObserver<T>(
  observer: LlmUsageObserver,
  operation: () => Promise<T>
): Promise<T> {
  return usageObserverContext.run(observer, operation);
}

/**
 * Observability must never turn an already-completed provider response into a
 * failed generation. Callers can independently alert on a recorder failure.
 */
export async function reportLlmUsage(usage: LlmUsage): Promise<void> {
  const observer = usageObserverContext.getStore();
  if (!observer) return;
  try {
    await observer(usage);
  } catch {
    // Best effort: the provider result is more valuable than a transient ledger write.
  }
}
