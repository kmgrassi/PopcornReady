import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARTIFACT_HASH_ALGORITHM,
  RELEASE_SCHEMA_VERSION,
  assertFullGitSha,
  hashFileManifest,
  listArtifactFiles,
  validateWebReleaseIdentity,
} from "./lib/release-identity.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDirectory = path.join(repoRoot, "apps/web/dist");
const gitSha = resolveGitSha();
const releaseOrchestrationId = assertFullGitSha(
  process.env.RELEASE_ORCHESTRATION_ID || gitSha,
  "RELEASE_ORCHESTRATION_ID",
);
const webArtifactSha256 = await hashFileManifest(
  distDirectory,
  await listArtifactFiles(distDirectory, { excludeRelative: ["release.json"] }),
);
const manifest = validateWebReleaseIdentity({
  schemaVersion: RELEASE_SCHEMA_VERSION,
  surface: "web",
  artifactHashAlgorithm: ARTIFACT_HASH_ALGORITHM,
  releaseOrchestrationId,
  gitSha,
  webArtifactSha256,
  builtAt: buildTimestamp(),
  environment: releaseEnvironment(),
});

await writeFile(
  path.join(distDirectory, "release.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { mode: 0o644 },
);
console.log(`Generated web release identity ${manifest.gitSha}`);

function resolveGitSha() {
  const candidate =
    process.env.RELEASE_GIT_SHA ||
    process.env.COMMIT_REF ||
    process.env.GITHUB_SHA ||
    execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  return assertFullGitSha(candidate, "gitSha");
}

function releaseEnvironment() {
  if (process.env.RELEASE_ENVIRONMENT) return process.env.RELEASE_ENVIRONMENT;
  return process.env.CONTEXT === "production" ? "production" : "development";
}

function buildTimestamp() {
  if (process.env.SOURCE_DATE_EPOCH) {
    return new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString();
  }
  return new Date().toISOString();
}

