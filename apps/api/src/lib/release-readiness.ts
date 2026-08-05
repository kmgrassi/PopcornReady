import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { QueryResultRow } from "pg";
import { withTransaction } from "./postgres/transactions.js";
import type { TransactionRunner } from "./postgres/creator-direct-confirmation.js";

const RELEASE_SCHEMA_VERSION = 1;
const ARTIFACT_HASH_ALGORITHM = "sha256-manifest-v1";
const MIGRATION_SET_ALGORITHM = "sha256-migration-set-v1";
const FULL_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MIGRATION_VERSION = /^\d{14}$/;

interface ApiReleaseManifest {
  schemaVersion: 1;
  surface: "api";
  artifactHashAlgorithm: "sha256-manifest-v1";
  releaseOrchestrationId: string;
  gitSha: string;
  apiArtifactSha256: string;
  builtAt: string;
  environment: "production" | "development" | "test";
  requiredMigrationCount: number;
  requiredMigrationSetSha256: string;
  requiredMigrationVersions: string[];
}

interface MigrationVersionRow extends QueryResultRow {
  version: string;
}

export interface ReleaseReadinessProjection {
  schemaVersion: 1 | null;
  surface: "api" | null;
  artifactHashAlgorithm: "sha256-manifest-v1" | null;
  ready: boolean;
  checked: boolean;
  manifestReady: boolean;
  platformCommitMatches: boolean | null;
  releaseOrchestrationId: string | null;
  gitSha: string | null;
  apiArtifactSha256: string | null;
  builtAt: string | null;
  environment: "production" | "development" | "test" | null;
  requiredMigrationCount: number | null;
  requiredMigrationSetSha256: string | null;
  appliedMigrationCount: number | null;
  appliedRequiredMigrationCount: number | null;
  appliedRequiredMigrationSetSha256: string | null;
  databaseCompatible: boolean | null;
}

interface ReleaseReadinessOptions {
  runTransaction?: TransactionRunner;
  env?: NodeJS.ProcessEnv;
  loadManifest?: () => Promise<unknown>;
}

export function createReleaseReadiness(options: ReleaseReadinessOptions = {}) {
  const runTransaction = options.runTransaction ?? withTransaction;
  const env = options.env ?? process.env;
  const loadManifest = options.loadManifest ?? loadApiReleaseManifest;
  let passed: ReleaseReadinessProjection | null = null;

  return async function releaseReadiness(): Promise<ReleaseReadinessProjection> {
    if (passed) return passed;
    const production = isProductionRuntime(env);
    let manifest: ApiReleaseManifest;
    try {
      manifest = validateApiReleaseManifest(await loadManifest());
    } catch {
      return emptyProjection({ ready: !production, checked: production });
    }

    const base = manifestProjection(manifest);
    const platformCommit =
      env.RAILWAY_GIT_COMMIT_SHA ??
      env.APP_COMMIT_SHA ??
      env.RELEASE_GIT_SHA ??
      null;
    const platformCommitMatches = platformCommit
      ? FULL_SHA.test(platformCommit) && platformCommit === manifest.gitSha
      : production ? false : null;
    if (
      production &&
      (manifest.environment !== "production" || platformCommitMatches !== true)
    ) {
      return {
        ...base,
        ready: false,
        checked: true,
        platformCommitMatches,
        databaseCompatible: false,
      };
    }

    if (!production && !env.DATABASE_URL) {
      return {
        ...base,
        ready: true,
        checked: false,
        platformCommitMatches,
      };
    }
    if (!env.DATABASE_URL) {
      return {
        ...base,
        ready: false,
        checked: true,
        platformCommitMatches,
        databaseCompatible: false,
      };
    }

    try {
      const appliedVersions = await runTransaction(
        "health.releaseMigrationReadiness",
        async (client) => {
          const result = await client.query<MigrationVersionRow>(
            `select version
               from supabase_migrations.schema_migrations
              order by version`,
          );
          return result.rows.map((row) => row.version);
        },
      );
      const compatibility = compareMigrationSets(
        manifest.requiredMigrationVersions,
        appliedVersions,
      );
      const projection: ReleaseReadinessProjection = {
        ...base,
        ready: compatibility.databaseCompatible,
        checked: true,
        platformCommitMatches,
        ...compatibility,
      };
      if (projection.ready) passed = projection;
      return projection;
    } catch {
      return {
        ...base,
        ready: false,
        checked: true,
        platformCommitMatches,
        databaseCompatible: false,
      };
    }
  };
}

export function validateApiReleaseManifest(value: unknown): ApiReleaseManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("API release manifest must be an object");
  }
  const manifest = value as Record<string, unknown>;
  if (manifest.schemaVersion !== RELEASE_SCHEMA_VERSION || manifest.surface !== "api") {
    throw new Error("Unsupported API release manifest schema");
  }
  if (manifest.artifactHashAlgorithm !== ARTIFACT_HASH_ALGORITHM) {
    throw new Error("Unsupported API artifact hash algorithm");
  }
  const gitSha = assertFullSha(manifest.gitSha, "gitSha");
  const releaseOrchestrationId = assertFullSha(
    manifest.releaseOrchestrationId,
    "releaseOrchestrationId",
  );
  if (gitSha !== releaseOrchestrationId) {
    throw new Error("releaseOrchestrationId and gitSha must match");
  }
  const apiArtifactSha256 = assertDigest(
    manifest.apiArtifactSha256,
    "apiArtifactSha256",
  );
  if (typeof manifest.builtAt !== "string" || !Number.isFinite(Date.parse(manifest.builtAt))) {
    throw new Error("builtAt must be ISO-8601");
  }
  if (!new Set(["production", "development", "test"]).has(String(manifest.environment))) {
    throw new Error("Invalid release environment");
  }
  const requiredMigrationVersions = canonicalMigrationVersions(
    manifest.requiredMigrationVersions,
  );
  if (
    !Number.isInteger(manifest.requiredMigrationCount) ||
    manifest.requiredMigrationCount !== requiredMigrationVersions.length
  ) {
    throw new Error("requiredMigrationCount does not match its version set");
  }
  const requiredMigrationSetSha256 = assertDigest(
    manifest.requiredMigrationSetSha256,
    "requiredMigrationSetSha256",
  );
  if (migrationSetSha256(requiredMigrationVersions) !== requiredMigrationSetSha256) {
    throw new Error("required migration set digest mismatch");
  }

  return {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    surface: "api",
    artifactHashAlgorithm: ARTIFACT_HASH_ALGORITHM,
    releaseOrchestrationId,
    gitSha,
    apiArtifactSha256,
    builtAt: manifest.builtAt,
    environment: manifest.environment as ApiReleaseManifest["environment"],
    requiredMigrationCount: requiredMigrationVersions.length,
    requiredMigrationSetSha256,
    requiredMigrationVersions,
  };
}

export function compareMigrationSets(
  requiredInput: unknown,
  appliedInput: unknown,
) {
  const required = canonicalMigrationVersions(requiredInput);
  const applied = canonicalMigrationVersions(appliedInput);
  const appliedSet = new Set(applied);
  const appliedRequired = required.filter((version) => appliedSet.has(version));
  return {
    requiredMigrationCount: required.length,
    requiredMigrationSetSha256: migrationSetSha256(required),
    appliedMigrationCount: applied.length,
    appliedRequiredMigrationCount: appliedRequired.length,
    appliedRequiredMigrationSetSha256: migrationSetSha256(appliedRequired),
    databaseCompatible: appliedRequired.length === required.length,
  };
}

function manifestProjection(manifest: ApiReleaseManifest): ReleaseReadinessProjection {
  return {
    schemaVersion: manifest.schemaVersion,
    surface: manifest.surface,
    artifactHashAlgorithm: manifest.artifactHashAlgorithm,
    ready: false,
    checked: false,
    manifestReady: true,
    platformCommitMatches: null,
    releaseOrchestrationId: manifest.releaseOrchestrationId,
    gitSha: manifest.gitSha,
    apiArtifactSha256: manifest.apiArtifactSha256,
    builtAt: manifest.builtAt,
    environment: manifest.environment,
    requiredMigrationCount: manifest.requiredMigrationCount,
    requiredMigrationSetSha256: manifest.requiredMigrationSetSha256,
    appliedMigrationCount: null,
    appliedRequiredMigrationCount: null,
    appliedRequiredMigrationSetSha256: null,
    databaseCompatible: null,
  };
}

function emptyProjection(
  input: Pick<ReleaseReadinessProjection, "ready" | "checked">,
): ReleaseReadinessProjection {
  return {
    ...input,
    schemaVersion: null,
    surface: null,
    artifactHashAlgorithm: null,
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
  };
}

function canonicalMigrationVersions(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Migration versions must be an array");
  const versions = value.map((version) => {
    if (typeof version !== "string" || !MIGRATION_VERSION.test(version)) {
      throw new Error("Invalid migration version");
    }
    return version;
  }).sort();
  if (new Set(versions).size !== versions.length) {
    throw new Error("Migration versions must be unique");
  }
  return versions;
}

function migrationSetSha256(versions: string[]): string {
  return createHash("sha256")
    .update(`${MIGRATION_SET_ALGORITHM}\n${versions.join("\n")}\n`)
    .digest("hex");
}

function assertFullSha(value: unknown, name: string): string {
  if (typeof value !== "string" || !FULL_SHA.test(value)) {
    throw new Error(`${name} must be a full lowercase git SHA`);
  }
  return value;
}

function assertDigest(value: unknown, name: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${name} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function isProductionRuntime(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "production" || Boolean(
    env.RAILWAY_ENVIRONMENT_ID ||
    env.RAILWAY_ENVIRONMENT_NAME ||
    env.RAILWAY_PROJECT_ID ||
    env.RAILWAY_SERVICE_ID
  );
}

async function loadApiReleaseManifest(): Promise<unknown> {
  const contents = await readFile(
    new URL("../../.release/release.json", import.meta.url),
    "utf8",
  );
  return JSON.parse(contents);
}

export const releaseReadiness = createReleaseReadiness();
