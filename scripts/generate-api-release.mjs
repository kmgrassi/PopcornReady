import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARTIFACT_HASH_ALGORITHM,
  RELEASE_SCHEMA_VERSION,
  apiArtifactFiles,
  assertFullGitSha,
  hashFileManifest,
  migrationSetSha256,
  migrationVersionsFromDirectory,
  validateApiReleaseIdentity,
} from "./lib/release-identity.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gitSha = resolveGitSha();
const releaseOrchestrationId = assertFullGitSha(
  process.env.RELEASE_ORCHESTRATION_ID || gitSha,
  "RELEASE_ORCHESTRATION_ID",
);
const requiredMigrationVersions = await migrationVersionsFromDirectory(
  path.join(repoRoot, "supabase/migrations"),
);
const apiArtifactSha256 = await hashFileManifest(
  repoRoot,
  await apiArtifactFiles(repoRoot),
);
const manifest = validateApiReleaseIdentity({
  schemaVersion: RELEASE_SCHEMA_VERSION,
  surface: "api",
  artifactHashAlgorithm: ARTIFACT_HASH_ALGORITHM,
  releaseOrchestrationId,
  gitSha,
  apiArtifactSha256,
  builtAt: buildTimestamp(),
  environment: releaseEnvironment(),
  requiredMigrationCount: requiredMigrationVersions.length,
  requiredMigrationSetSha256: migrationSetSha256(requiredMigrationVersions),
  requiredMigrationVersions,
});

const outputDirectory = path.join(repoRoot, "apps/api/.release");
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  path.join(outputDirectory, "release.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { mode: 0o644 },
);
console.log(
  `Generated API release identity ${manifest.gitSha} (${manifest.requiredMigrationCount} required migrations)`,
);

function resolveGitSha() {
  const candidate =
    process.env.RELEASE_GIT_SHA ||
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  return assertFullGitSha(candidate, "gitSha");
}

function releaseEnvironment() {
  if (process.env.RELEASE_ENVIRONMENT) return process.env.RELEASE_ENVIRONMENT;
  return process.env.RAILWAY_ENVIRONMENT_NAME === "production" ? "production" : "development";
}

function buildTimestamp() {
  if (process.env.SOURCE_DATE_EPOCH) {
    return new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString();
  }
  return new Date().toISOString();
}

