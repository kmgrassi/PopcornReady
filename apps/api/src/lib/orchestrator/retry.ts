// Step-level durability for the orchestrator loop. Each turn performs several
// store round-trips (read actions/gates, persist invocations, patch the run); a
// single transient blip in any of them otherwise propagates up and fails the
// whole run (driveGuarded marks it failed). withRetry wraps an individual async
// step in bounded exponential-backoff retries; withStoreRetry applies it to the
// idempotent store methods so a transient infra error costs a retry, not the run.
//
// See docs/scopes/orchestrator-step-durability.md and
// docs/research/async-tool-calling-orchestrator.md (per-step durability is the
// report's "first-class state object with retry metadata" checklist item).

import type { OrchestratorEngineStore } from "./engine";

export interface RetryOptions {
  /** Total attempts including the first. Default 3. */
  attempts?: number;
  /** Backoff base in ms (delay = base * 2^(attempt-1), capped at maxDelayMs). Default 50. */
  baseDelayMs?: number;
  /** Backoff cap in ms. Default 1000. */
  maxDelayMs?: number;
  /** Return false to stop retrying a given error (e.g. a non-transient bug). Default: always retry. */
  shouldRetry?: (err: unknown) => boolean;
  /** Injectable for tests so backoff does not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Observability hook fired before each backoff wait. */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Run `fn`, retrying on failure up to `attempts` times with exponential backoff.
// Rethrows the last error once attempts are exhausted or shouldRetry returns false.
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const baseDelayMs = opts.baseDelayMs ?? 50;
  const maxDelayMs = opts.maxDelayMs ?? 1000;
  const shouldRetry = opts.shouldRetry ?? (() => true);
  const sleep = opts.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= attempts || !shouldRetry(err)) break;
      const delayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      opts.onRetry?.(err, attempt, delayMs);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

// Wrap a store so its IDEMPOTENT methods retry on transient failure. Invocation
// writes now carry a caller-reserved action id, so their first insert wins and a
// retried write reloads that same action instead of appending a duplicate.
export function withStoreRetry(
  store: OrchestratorEngineStore,
  opts?: RetryOptions
): OrchestratorEngineStore {
  const retry = <T>(fn: () => Promise<T>) => withRetry(fn, opts);
  return {
    getOrchestratorRun: (id) => retry(() => store.getOrchestratorRun(id)),
    updateOrchestratorRun: (id, patch) => retry(() => store.updateOrchestratorRun(id, patch)),
    ...(store.claimOrchestratorRunResume
      ? {
          claimOrchestratorRunResume: (id: string) =>
            retry(() => store.claimOrchestratorRunResume!(id)),
        }
      : {}),
    listRunGates: (id) => retry(() => store.listRunGates(id)),
    markGateReached: (id, stage) => retry(() => store.markGateReached(id, stage)),
    listRunActions: (id) => retry(() => store.listRunActions(id)),
    recordInvocation: (input) => retry(() => store.recordInvocation(input)),
    // idempotent patch keyed by actionId — safe to retry.
    markInvocation: (actionId, patch) => retry(() => store.markInvocation(actionId, patch)),
  };
}
