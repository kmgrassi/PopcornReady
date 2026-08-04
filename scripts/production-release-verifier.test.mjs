import assert from "node:assert/strict";
import test from "node:test";
import {
  ReleaseNotReadyError,
  readBoundedJsonBody,
  validateJsonResponseMetadata,
  validateProductionOrigin,
  verifyReleaseCoherence,
} from "./lib/production-release-verifier.mjs";

const SHA = "a".repeat(40);
const OLD_SHA = "b".repeat(40);
const MIGRATION_DIGEST = "c".repeat(64);

function webRelease(gitSha = SHA) {
  return {
    schemaVersion: 1,
    surface: "web",
    artifactHashAlgorithm: "sha256-manifest-v1",
    releaseOrchestrationId: gitSha,
    gitSha,
    webArtifactSha256: "d".repeat(64),
    builtAt: "2026-08-04T15:00:00.000Z",
    environment: "production",
  };
}

function apiHealth(gitSha = SHA, releaseOverrides = {}) {
  return {
    status: "ok",
    commit: gitSha,
    release: {
      schemaVersion: 1,
      surface: "api",
      artifactHashAlgorithm: "sha256-manifest-v1",
      ready: true,
      checked: true,
      manifestReady: true,
      platformCommitMatches: true,
      releaseOrchestrationId: gitSha,
      gitSha,
      apiArtifactSha256: "e".repeat(64),
      builtAt: "2026-08-04T15:01:00.000Z",
      environment: "production",
      requiredMigrationCount: 100,
      requiredMigrationSetSha256: MIGRATION_DIGEST,
      appliedMigrationCount: 102,
      appliedRequiredMigrationCount: 100,
      appliedRequiredMigrationSetSha256: MIGRATION_DIGEST,
      databaseCompatible: true,
      ...releaseOverrides,
    },
  };
}

test("coherence accepts exact web, direct API, and proxied API identities", () => {
  const result = verifyReleaseCoherence({
    expectedGitSha: SHA,
    webRelease: webRelease(),
    directApiHealth: apiHealth(),
    proxiedApiHealth: apiHealth(),
  });
  assert.equal(result.gitSha, SHA);
  assert.equal(result.requiredMigrationCount, 100);
  assert.notEqual(result.webArtifactSha256, result.apiArtifactSha256);
});

for (const fixture of [
  {
    name: "old web with new API",
    web: webRelease(OLD_SHA),
    direct: apiHealth(),
    proxy: apiHealth(),
  },
  {
    name: "new web with old API",
    web: webRelease(),
    direct: apiHealth(OLD_SHA),
    proxy: apiHealth(OLD_SHA),
  },
  {
    name: "same-origin proxy reaches another API",
    web: webRelease(),
    direct: apiHealth(),
    proxy: apiHealth(OLD_SHA),
  },
]) {
  test(`${fixture.name} is not release-coherent`, () => {
    assert.throws(
      () => verifyReleaseCoherence({
        expectedGitSha: SHA,
        webRelease: fixture.web,
        directApiHealth: fixture.direct,
        proxiedApiHealth: fixture.proxy,
      }),
    );
  });
}

test("SHA prefixes and database-not-ready health fail closed", () => {
  assert.throws(
    () => verifyReleaseCoherence({
      expectedGitSha: SHA,
      webRelease: webRelease(),
      directApiHealth: apiHealth(SHA.slice(0, 8)),
      proxiedApiHealth: apiHealth(),
    }),
  );
  assert.throws(
    () => verifyReleaseCoherence({
      expectedGitSha: SHA,
      webRelease: webRelease(),
      directApiHealth: apiHealth(SHA, { ready: false, databaseCompatible: false }),
      proxiedApiHealth: apiHealth(),
    }),
    ReleaseNotReadyError,
  );
});

test("response metadata rejects HTML fallback and cacheable identity", () => {
  assert.throws(
    () => validateJsonResponseMetadata({
      status: 200,
      contentType: "text/html",
      cacheControl: "no-store",
    }, "web release metadata"),
    /not JSON/,
  );
  assert.throws(
    () => validateJsonResponseMetadata({
      status: 200,
      contentType: "application/json",
      cacheControl: "public, max-age=60",
    }, "web release metadata"),
    /not marked no-store/,
  );
  assert.throws(
    () => validateJsonResponseMetadata({
      status: 200,
      contentType: "application/jsonp",
      cacheControl: "public, x-no-store=true",
    }, "web release metadata"),
    /not JSON/,
  );
  assert.throws(
    () => validateJsonResponseMetadata({
      status: 200,
      contentType: "application/json; charset=utf-8",
      cacheControl: "public, x-no-store=true",
    }, "web release metadata"),
    /not marked no-store/,
  );
});

test("bounded JSON reader cancels an oversized stream without content-length", async () => {
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(40_000));
      controller.enqueue(new Uint8Array(40_000));
      controller.close();
    },
  }), {
    headers: { "content-type": "application/json" },
  });
  await assert.rejects(
    readBoundedJsonBody(response, "direct API"),
    /response is too large/,
  );
});

test("API release contract schema, surface, and algorithm fail closed", () => {
  for (const overrides of [
    { schemaVersion: 2 },
    { surface: "web" },
    { artifactHashAlgorithm: "sha256-manifest-v2" },
  ]) {
    assert.throws(
      () => verifyReleaseCoherence({
        expectedGitSha: SHA,
        webRelease: webRelease(),
        directApiHealth: apiHealth(SHA, overrides),
        proxiedApiHealth: apiHealth(),
      }),
      /release contract identity is incompatible/,
    );
  }
});

test("production verifier accepts only approved credential-free HTTPS origins", () => {
  assert.equal(
    validateProductionOrigin("https://popcornready.ai", "web").hostname,
    "popcornready.ai",
  );
  for (const value of [
    "http://popcornready.ai",
    "https://localhost",
    "https://user:password@popcornready.ai",
    "https://popcornready.ai/path",
    "https://example.com",
  ]) {
    assert.throws(() => validateProductionOrigin(value, "origin"));
  }
});
