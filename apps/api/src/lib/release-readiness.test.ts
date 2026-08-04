import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import type { TransactionRunner } from "./postgres/creator-direct-confirmation.js";
import {
  compareMigrationSets,
  createReleaseReadiness,
  validateApiReleaseManifest,
} from "./release-readiness.js";

const SHA = "a".repeat(40);
const OTHER_SHA = "b".repeat(40);
const REQUIRED = ["20260101000000", "20260301000000"];

function manifest(overrides: Record<string, unknown> = {}) {
  const compatibility = compareMigrationSets(REQUIRED, REQUIRED);
  return {
    schemaVersion: 1,
    surface: "api",
    artifactHashAlgorithm: "sha256-manifest-v1",
    releaseOrchestrationId: SHA,
    gitSha: SHA,
    apiArtifactSha256: "c".repeat(64),
    builtAt: "2026-08-04T15:00:00.000Z",
    environment: "production",
    requiredMigrationCount: compatibility.requiredMigrationCount,
    requiredMigrationSetSha256: compatibility.requiredMigrationSetSha256,
    requiredMigrationVersions: REQUIRED,
    ...overrides,
  };
}

function ledgerRunner(versions: string[]): {
  runner: TransactionRunner;
  calls: () => number;
  sql: () => string;
} {
  let calls = 0;
  let observedSql = "";
  const runner: TransactionRunner = async (_operation, callback) => {
    calls += 1;
    return callback({
      async query(sql: string) {
        observedSql = sql;
        return {
          rows: versions.map((version) => ({ version })),
          rowCount: versions.length,
        };
      },
    } as unknown as PoolClient);
  };
  return { runner, calls: () => calls, sql: () => observedSql };
}

test("production release readiness accepts exact migrations and caches success", async () => {
  const ledger = ledgerRunner(REQUIRED);
  const readiness = createReleaseReadiness({
    runTransaction: ledger.runner,
    env: {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://configured",
      RAILWAY_GIT_COMMIT_SHA: SHA,
    },
    loadManifest: async () => manifest(),
  });

  const first = await readiness();
  const second = await readiness();
  assert.equal(first.ready, true);
  assert.equal(first.databaseCompatible, true);
  assert.equal(first.platformCommitMatches, true);
  assert.equal(first.appliedMigrationCount, REQUIRED.length);
  assert.deepEqual(second, first);
  assert.equal(ledger.calls(), 1);
  assert.match(ledger.sql(), /select version[\s\S]*supabase_migrations\.schema_migrations/);
  assert.doesNotMatch(ledger.sql(), /statements|name|insert|update|delete/i);
});

test("extra lower and higher applied migrations remain rollback-compatible", async () => {
  const ledger = ledgerRunner([
    "20251201000000",
    ...REQUIRED,
    "20260401000000",
  ]);
  const readiness = createReleaseReadiness({
    runTransaction: ledger.runner,
    env: {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://configured",
      RAILWAY_GIT_COMMIT_SHA: SHA,
    },
    loadManifest: async () => manifest(),
  });

  const result = await readiness();
  assert.equal(result.ready, true);
  assert.equal(result.databaseCompatible, true);
  assert.equal(result.appliedMigrationCount, 4);
  assert.equal(result.appliedRequiredMigrationCount, 2);
  assert.equal(
    result.appliedRequiredMigrationSetSha256,
    result.requiredMigrationSetSha256,
  );
});

test("a missing required migration fails closed without exposing versions", async () => {
  const ledger = ledgerRunner([REQUIRED[0]]);
  const readiness = createReleaseReadiness({
    runTransaction: ledger.runner,
    env: {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://configured",
      RAILWAY_GIT_COMMIT_SHA: SHA,
    },
    loadManifest: async () => manifest(),
  });

  const result = await readiness();
  assert.equal(result.ready, false);
  assert.equal(result.databaseCompatible, false);
  assert.equal(result.appliedMigrationCount, 1);
  assert.equal("requiredMigrationVersions" in result, false);
});

test("production rejects a platform commit mismatch before reading the ledger", async () => {
  const ledger = ledgerRunner(REQUIRED);
  const readiness = createReleaseReadiness({
    runTransaction: ledger.runner,
    env: {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://configured",
      RAILWAY_GIT_COMMIT_SHA: OTHER_SHA,
    },
    loadManifest: async () => manifest(),
  });

  const result = await readiness();
  assert.equal(result.ready, false);
  assert.equal(result.platformCommitMatches, false);
  assert.equal(ledger.calls(), 0);
});

test("missing production metadata fails closed while local development stays live", async () => {
  const missing = async () => {
    throw new Error("missing");
  };
  const production = createReleaseReadiness({
    env: { NODE_ENV: "production" },
    loadManifest: missing,
  });
  const local = createReleaseReadiness({
    env: { NODE_ENV: "development" },
    loadManifest: missing,
  });

  assert.deepEqual(await production(), {
    schemaVersion: null,
    surface: null,
    artifactHashAlgorithm: null,
    ready: false,
    checked: true,
    manifestReady: false,
    platformCommitMatches: null,
    releaseOrchestrationId: null,
    gitSha: null,
    apiArtifactSha256: null,
    builtAt: null,
    environment: null,
    requiredMigrationCount: null,
    requiredMigrationSetSha256: null,
    appliedMigrationCount: null,
    appliedRequiredMigrationCount: null,
    appliedRequiredMigrationSetSha256: null,
    databaseCompatible: null,
  });
  assert.equal((await local()).ready, true);
  assert.equal((await local()).checked, false);
});

test("manifest validation rejects partial SHAs and migration digest drift", () => {
  assert.throws(
    () => validateApiReleaseManifest(manifest({ gitSha: SHA.slice(0, 8) })),
    /full lowercase git SHA/,
  );
  assert.throws(
    () => validateApiReleaseManifest(manifest({ requiredMigrationSetSha256: "d".repeat(64) })),
    /digest mismatch/,
  );
});
