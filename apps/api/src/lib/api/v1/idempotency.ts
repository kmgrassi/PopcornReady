// Idempotency for mutating v1 routes.
//
// The durable reservation lives in Postgres, rather than an in-process mutex,
// so two API instances cannot both execute a matching producer. A reservation
// lease does not hold a database transaction open across external work: callers
// poll a live reservation, replay a completed response, or atomically reclaim an
// expired reservation. Active producers renew their lease; provider-side
// execution still needs its own job claim fence.

import {
  abandonIdempotencyRecord,
  completeIdempotencyRecord,
  renewIdempotencyRecord,
  reserveIdempotencyRecord,
} from "./store";
import { ApiError } from "./errors";

export interface ApiResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface IdempotencyStore {
  reserve(input: {
    scope: string;
    key: string;
    bodyHash: string;
    leaseSeconds: number;
  }): ReturnType<typeof reserveIdempotencyRecord>;
  complete(input: {
    scope: string;
    key: string;
    bodyHash: string;
    leaseToken: string;
    status: number;
    responseBody: unknown;
  }): Promise<boolean>;
  renew(input: {
    scope: string;
    key: string;
    bodyHash: string;
    leaseToken: string;
    leaseSeconds: number;
  }): Promise<boolean>;
  abandon(input: {
    scope: string;
    key: string;
    bodyHash: string;
    leaseToken: string;
  }): Promise<boolean>;
}

export interface IdempotencyOptions {
  store?: IdempotencyStore;
  leaseSeconds?: number;
  pollIntervalMs?: number;
  maxWaitMs?: number;
  now?(): number;
  sleep?(ms: number): Promise<void>;
  scheduleRenewal?(callback: () => void, delayMs: number): ReturnType<typeof setInterval>;
  clearRenewal?(timer: ReturnType<typeof setInterval>): void;
}

const DEFAULT_LEASE_SECONDS = 60;
const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_MAX_WAIT_MS = 5_000;

const defaultStore: IdempotencyStore = {
  reserve: reserveIdempotencyRecord,
  complete: completeIdempotencyRecord,
  renew: renewIdempotencyRecord,
  abandon: abandonIdempotencyRecord,
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function inProgressError(): ApiError {
  return new ApiError(
    "idempotency_in_progress",
    "A matching request is still in progress. Retry this Idempotency-Key shortly.",
    { retryAfterSeconds: 1 }
  );
}

/**
 * Runs one producer per durable `(scope, key, bodyHash)` reservation. A caller
 * that loses the initial reservation waits for the winner's completed response;
 * it never executes the producer itself while the lease is live.
 */
export async function runIdempotent(
  scope: string,
  key: string,
  bodyHash: string,
  produce: () => Promise<ApiResult>,
  options: IdempotencyOptions = {}
): Promise<ApiResult> {
  const store = options.store ?? defaultStore;
  const leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? delay;
  const scheduleRenewal = options.scheduleRenewal ?? setInterval;
  const clearRenewal = options.clearRenewal ?? clearInterval;
  const deadline = now() + maxWaitMs;

  for (;;) {
    const reservation = await store.reserve({ scope, key, bodyHash, leaseSeconds });
    if (reservation.state === "conflict") {
      throw new ApiError(
        "idempotency_conflict",
        "This Idempotency-Key was already used with a different request body."
      );
    }
    if (reservation.state === "replay") {
      if (reservation.status === undefined) {
        throw new ApiError("internal_error", "Completed idempotency record was missing status.");
      }
      return { status: reservation.status, body: reservation.responseBody };
    }
    if (reservation.state === "pending") {
      if (now() >= deadline) throw inProgressError();
      await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - now())));
      continue;
    }

    if (!reservation.leaseToken) {
      throw new ApiError("internal_error", "Idempotency reservation was missing its lease token.");
    }

    let result: ApiResult;
    const renewInterval = scheduleRenewal(() => {
      void store
        .renew({ scope, key, bodyHash, leaseToken: reservation.leaseToken!, leaseSeconds })
        .catch(() => undefined);
    }, Math.max(1_000, Math.floor((leaseSeconds * 1_000) / 2)));
    (renewInterval as { unref?: () => void }).unref?.();
    try {
      result = await produce();
    } catch (err) {
      await store
        .abandon({ scope, key, bodyHash, leaseToken: reservation.leaseToken })
        .catch(() => undefined);
      throw err;
    } finally {
      clearRenewal(renewInterval);
    }

    if (result.status < 200 || result.status >= 300) {
      await store
        .abandon({ scope, key, bodyHash, leaseToken: reservation.leaseToken })
        .catch(() => undefined);
      return result;
    }

    // Renewal is best-effort. Completion's lease-token predicate is the
    // authoritative ownership check: a transient renew failure must not throw
    // away a successful response while this producer still owns the row.
    const completed = await store.complete({
      scope,
      key,
      bodyHash,
      leaseToken: reservation.leaseToken,
      status: result.status,
      responseBody: result.body,
    });
    if (!completed) {
      // Do not release here: the token may have been reclaimed after a slow
      // producer. Let the durable lease/replay state fence any retry.
      throw inProgressError();
    }
    return result;
  }
}
