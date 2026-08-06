import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export const RELEASE_SCHEMA_VERSION = 1;
export const ARTIFACT_HASH_ALGORITHM = "sha256-manifest-v1";
export const MIGRATION_SET_ALGORITHM = "sha256-migration-set-v1";

const FULL_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MIGRATION_VERSION = /^\d{14}$/;

export function assertFullGitSha(value, fieldName) {
  if (typeof value !== "string" || !FULL_SHA.test(value)) {
    throw new Error(`${fieldName} must be a lowercase 40-character git SHA`);
  }
  return value;
}

export function assertSha256(value, fieldName) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${fieldName} must be a lowercase SHA-256 digest`);
  }
  return value;
}

export function canonicalMigrationVersions(versions) {
  const canonical = [...versions].map((version) => {
    if (typeof version !== "string" || !MIGRATION_VERSION.test(version)) {
      throw new Error(`Invalid migration version: ${String(version)}`);
    }
    return version;
  }).sort();
  if (new Set(canonical).size !== canonical.length) {
    throw new Error("Migration versions must be unique");
  }
  return canonical;
}

export function migrationSetSha256(versions) {
  const canonical = canonicalMigrationVersions(versions);
  return createHash("sha256")
    .update(`${MIGRATION_SET_ALGORITHM}\n${canonical.join("\n")}\n`)
    .digest("hex");
}

export function compareMigrationSets(requiredVersions, appliedVersions) {
  const required = canonicalMigrationVersions(requiredVersions);
  const applied = canonicalMigrationVersions(appliedVersions);
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

export async function migrationVersionsFromDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const versions = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".sql")) continue;
    const match = /^(\d{14})_.+\.sql$/.exec(entry.name);
    if (!match) throw new Error(`Invalid migration filename: ${entry.name}`);
    versions.push(match[1]);
  }
  return canonicalMigrationVersions(versions);
}

export async function hashFileManifest(rootDirectory, files) {
  const root = path.resolve(rootDirectory);
  const relativeFiles = files.map((file) => {
    const relative = path.relative(root, path.resolve(file)).split(path.sep).join("/");
    if (!relative || relative.startsWith("../")) {
      throw new Error(`Artifact file is outside the manifest root: ${file}`);
    }
    return relative;
  }).sort();
  if (new Set(relativeFiles).size !== relativeFiles.length) {
    throw new Error("Artifact manifest contains duplicate files");
  }

  const hash = createHash("sha256");
  hash.update(`${ARTIFACT_HASH_ALGORITHM}\n`);
  for (const relative of relativeFiles) {
    hash.update(relative);
    hash.update("\0");
    hash.update(await readFile(path.join(root, relative)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function listArtifactFiles(directory, options = {}) {
  const root = path.resolve(directory);
  const excluded = new Set(options.excludeRelative ?? []);
  const files = [];

  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (excluded.has(relative)) continue;
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }

  await visit(root);
  return files;
}

export const API_ARTIFACT_ROOTS = [
    "apps/api/src",
    "apps/api/scripts",
    "packages/agent/src",
    "packages/eval/src",
    "packages/llm/src",
    "packages/renderer/src",
    "packages/shared/src",
    "packages/timeline/src",
  ];
export const API_ARTIFACT_SINGLE_FILES = [
    "apps/api/package.json",
    "apps/api/tsconfig.json",
    "packages/agent/package.json",
    "packages/agent/tsconfig.json",
    "packages/eval/package.json",
    "packages/eval/tsconfig.json",
    "packages/llm/package.json",
    "packages/llm/tsconfig.json",
    "packages/renderer/package.json",
    "packages/renderer/tsconfig.json",
    "packages/shared/package.json",
    "packages/shared/tsconfig.json",
    "packages/shared/tsconfig.type-tests.json",
    "packages/timeline/package.json",
    "packages/timeline/tsconfig.json",
    "scripts/generate-api-release.mjs",
    "scripts/lib/release-identity.mjs",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "railway.toml",
    "tsconfig.base.json",
  ];

export async function apiArtifactFiles(repoRoot) {
  const files = [];
  for (const relative of API_ARTIFACT_ROOTS) {
    const absolute = path.join(repoRoot, relative);
    try {
      if ((await stat(absolute)).isDirectory()) {
        files.push(...await listArtifactFiles(absolute));
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  for (const relative of API_ARTIFACT_SINGLE_FILES) {
    const absolute = path.join(repoRoot, relative);
    if ((await stat(absolute)).isFile()) files.push(absolute);
  }
  return files;
}

export function validateWebReleaseIdentity(value, options = {}) {
  assertObject(value, "web release identity");
  assertEnvelope(value, "web", options);
  assertSha256(value.webArtifactSha256, "webArtifactSha256");
  return value;
}

export function validateApiReleaseIdentity(value, options = {}) {
  assertObject(value, "API release identity");
  assertEnvelope(value, "api", options);
  assertSha256(value.apiArtifactSha256, "apiArtifactSha256");
  if (!Number.isInteger(value.requiredMigrationCount) || value.requiredMigrationCount < 0) {
    throw new Error("requiredMigrationCount must be a non-negative integer");
  }
  assertSha256(value.requiredMigrationSetSha256, "requiredMigrationSetSha256");
  const versions = canonicalMigrationVersions(value.requiredMigrationVersions ?? []);
  if (versions.length !== value.requiredMigrationCount) {
    throw new Error("requiredMigrationCount does not match requiredMigrationVersions");
  }
  if (migrationSetSha256(versions) !== value.requiredMigrationSetSha256) {
    throw new Error("required migration set digest does not match its versions");
  }
  return value;
}

function assertEnvelope(value, surface, options) {
  if (value.schemaVersion !== RELEASE_SCHEMA_VERSION) {
    throw new Error(`Unsupported release schemaVersion: ${String(value.schemaVersion)}`);
  }
  if (value.surface !== surface) throw new Error(`Expected ${surface} release identity`);
  if (value.artifactHashAlgorithm !== ARTIFACT_HASH_ALGORITHM) {
    throw new Error("Unsupported artifact hash algorithm");
  }
  const gitSha = assertFullGitSha(value.gitSha, "gitSha");
  const orchestrationId = assertFullGitSha(
    value.releaseOrchestrationId,
    "releaseOrchestrationId",
  );
  if (gitSha !== orchestrationId) {
    throw new Error("releaseOrchestrationId and gitSha must match in schema v1");
  }
  if (options.expectedGitSha && gitSha !== options.expectedGitSha) {
    throw new Error(`Release identity does not match expected git SHA`);
  }
  if (!Number.isFinite(Date.parse(value.builtAt))) throw new Error("builtAt must be ISO-8601");
  if (!new Set(["production", "development", "test"]).has(value.environment)) {
    throw new Error("environment must be production, development, or test");
  }
  if (options.requireProduction && value.environment !== "production") {
    throw new Error("Production release identity required");
  }
}

function assertObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}
