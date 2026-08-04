import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  API_ARTIFACT_SINGLE_FILES,
  ARTIFACT_HASH_ALGORITHM,
  RELEASE_SCHEMA_VERSION,
  apiArtifactFiles,
  compareMigrationSets,
  hashFileManifest,
  listArtifactFiles,
  migrationSetSha256,
  validateApiReleaseIdentity,
  validateWebReleaseIdentity,
} from "./lib/release-identity.mjs";

const SHA = "1".repeat(40);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("artifact hashes are order-independent and change with source bytes", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "popcorn-release-hash-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(directory, { recursive: true, force: true });
  });
  const first = path.join(directory, "a.txt");
  const second = path.join(directory, "b.txt");
  await writeFile(first, "alpha");
  await writeFile(second, "beta");

  const forward = await hashFileManifest(directory, [first, second]);
  const reverse = await hashFileManifest(directory, [second, first]);
  assert.equal(forward, reverse);

  await writeFile(second, "beta changed");
  assert.notEqual(await hashFileManifest(directory, [first, second]), forward);
});

test("API artifact digest covers dependency manifests and release-generator bytes", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "popcorn-api-artifact-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(directory, { recursive: true, force: true });
  });
  for (const relative of API_ARTIFACT_SINGLE_FILES) {
    const absolute = path.join(directory, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, `fixture:${relative}\n`);
  }

  const files = await apiArtifactFiles(directory);
  const relativeFiles = files.map((file) => path.relative(directory, file));
  assert.ok(relativeFiles.includes("packages/shared/package.json"));
  assert.ok(relativeFiles.includes("scripts/generate-api-release.mjs"));
  assert.ok(relativeFiles.includes("scripts/lib/release-identity.mjs"));

  const baseline = await hashFileManifest(directory, files);
  await writeFile(
    path.join(directory, "packages/shared/package.json"),
    "changed dependency manifest\n",
  );
  const manifestChanged = await hashFileManifest(
    directory,
    await apiArtifactFiles(directory),
  );
  assert.notEqual(manifestChanged, baseline);
  await writeFile(
    path.join(directory, "scripts/generate-api-release.mjs"),
    "changed generator bytes\n",
  );
  assert.notEqual(
    await hashFileManifest(directory, await apiArtifactFiles(directory)),
    manifestChanged,
  );
});

test("generated API manifest recomputes from the canonical artifact inputs", () => {
  execFileSync(process.execPath, ["scripts/generate-api-release.mjs"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      RELEASE_GIT_SHA: SHA,
      RELEASE_ORCHESTRATION_ID: SHA,
      RELEASE_ENVIRONMENT: "test",
    },
    stdio: "pipe",
  });
  execFileSync(
    process.execPath,
    ["scripts/verify-generated-release.mjs", "api"],
    { cwd: repoRoot, stdio: "pipe" },
  );
});

test("Netlify release metadata is explicitly JSON and no-store", async () => {
  const config = await readFile(path.join(repoRoot, "netlify.toml"), "utf8");
  assert.match(
    config,
    /\[\[headers\]\][\s\S]*for = "\/release\.json"[\s\S]*Cache-Control = "no-store"[\s\S]*Content-Type = "application\/json; charset=utf-8"/,
  );
});

test("web artifact enumeration excludes the self-referential release file", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "popcorn-release-self-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(directory, { recursive: true, force: true });
  });
  await writeFile(path.join(directory, "index.html"), "app");
  await writeFile(path.join(directory, "release.json"), "old metadata");
  const files = await listArtifactFiles(directory, { excludeRelative: ["release.json"] });
  assert.deepEqual(files.map((file) => path.basename(file)), ["index.html"]);
});

test("migration-set compatibility permits extra lower and higher versions", () => {
  const required = ["20260201000000", "20260401000000"];
  const exact = compareMigrationSets(required, required);
  const extended = compareMigrationSets(required, [
    "20260101000000",
    ...required,
    "20260501000000",
  ]);
  const missing = compareMigrationSets(required, [required[0]]);

  assert.equal(exact.databaseCompatible, true);
  assert.equal(extended.databaseCompatible, true);
  assert.equal(extended.appliedMigrationCount, 4);
  assert.equal(
    extended.appliedRequiredMigrationSetSha256,
    migrationSetSha256(required),
  );
  assert.equal(missing.databaseCompatible, false);
});

test("web and API identities are separately typed full-SHA envelopes", () => {
  const common = {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    artifactHashAlgorithm: ARTIFACT_HASH_ALGORITHM,
    releaseOrchestrationId: SHA,
    gitSha: SHA,
    builtAt: "2026-08-04T15:00:00.000Z",
    environment: "production",
  };
  assert.equal(validateWebReleaseIdentity({
    ...common,
    surface: "web",
    webArtifactSha256: "2".repeat(64),
  }).surface, "web");
  assert.equal(validateApiReleaseIdentity({
    ...common,
    surface: "api",
    apiArtifactSha256: "3".repeat(64),
    requiredMigrationCount: 1,
    requiredMigrationSetSha256: migrationSetSha256(["20260101000000"]),
    requiredMigrationVersions: ["20260101000000"],
  }).surface, "api");
  assert.throws(
    () => validateWebReleaseIdentity({
      ...common,
      surface: "web",
      gitSha: SHA.slice(0, 8),
      webArtifactSha256: "2".repeat(64),
    }),
    /40-character git SHA/,
  );
});
