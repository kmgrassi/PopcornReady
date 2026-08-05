import {
  assertFullGitSha,
  assertSha256,
  validateWebReleaseIdentity,
} from "./release-identity.mjs";

const APPROVED_PRODUCTION_HOSTS = new Set([
  "popcornready.ai",
  "www.popcornready.ai",
  "popcornready-production.up.railway.app",
]);

export class ReleaseNotReadyError extends Error {
  constructor(stage, message) {
    super(`${stage}: ${message}`);
    this.name = "ReleaseNotReadyError";
    this.stage = stage;
  }
}

export function validateProductionOrigin(value, fieldName) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${fieldName} must be a valid URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`${fieldName} must be credential-free HTTPS`);
  }
  if (!APPROVED_PRODUCTION_HOSTS.has(url.hostname) || url.port) {
    throw new Error(`${fieldName} is not an approved production origin`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${fieldName} must not include a path, query, or fragment`);
  }
  return url;
}

export function validateJsonResponseMetadata(metadata, stage) {
  if (metadata.status !== 200) {
    throw new ReleaseNotReadyError(stage, `HTTP ${metadata.status}`);
  }
  const mediaType = String(metadata.contentType ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new ReleaseNotReadyError(stage, "response is not JSON");
  }
  const cacheDirectives = String(metadata.cacheControl ?? "")
    .split(",")
    .map((directive) => directive.trim().toLowerCase());
  if (!cacheDirectives.includes("no-store")) {
    throw new ReleaseNotReadyError(stage, "response is not marked no-store");
  }
}

export async function readBoundedJsonBody(response, stage, maxBytes = 65_536) {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ReleaseNotReadyError(stage, "response is too large");
  }
  if (!response.body) {
    throw new ReleaseNotReadyError(stage, "response body is missing");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new ReleaseNotReadyError(stage, "response is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ReleaseNotReadyError(stage, "response body is not valid JSON");
  }
}

export function verifyReleaseCoherence({
  expectedGitSha,
  webRelease,
  directApiHealth,
  proxiedApiHealth,
}) {
  const expected = assertFullGitSha(expectedGitSha, "expectedGitSha");
  const web = validateWebReleaseIdentity(webRelease, {
    expectedGitSha: expected,
    requireProduction: true,
  });
  const direct = validateApiHealth(directApiHealth, expected, "direct API");
  const proxy = validateApiHealth(proxiedApiHealth, expected, "same-origin API proxy");

  if (web.releaseOrchestrationId !== direct.release.releaseOrchestrationId) {
    throw new ReleaseNotReadyError("release coherence", "web and API orchestration IDs differ");
  }
  if (web.webArtifactSha256 === direct.release.apiArtifactSha256) {
    throw new ReleaseNotReadyError("release coherence", "web and API artifact hashes must be distinct");
  }
  for (const field of [
    "schemaVersion",
    "surface",
    "artifactHashAlgorithm",
    "releaseOrchestrationId",
    "gitSha",
    "apiArtifactSha256",
    "requiredMigrationSetSha256",
    "appliedRequiredMigrationSetSha256",
  ]) {
    if (direct.release[field] !== proxy.release[field]) {
      throw new ReleaseNotReadyError(
        "same-origin API proxy",
        `${field} differs from the direct API`,
      );
    }
  }
  if (
    direct.release.requiredMigrationCount !== proxy.release.requiredMigrationCount ||
    direct.release.appliedMigrationCount !== proxy.release.appliedMigrationCount
  ) {
    throw new ReleaseNotReadyError(
      "same-origin API proxy",
      "migration counts differ from the direct API",
    );
  }

  return {
    releaseOrchestrationId: expected,
    gitSha: expected,
    webArtifactSha256: web.webArtifactSha256,
    apiArtifactSha256: direct.release.apiArtifactSha256,
    webBuiltAt: web.builtAt,
    apiBuiltAt: direct.release.builtAt,
    requiredMigrationCount: direct.release.requiredMigrationCount,
    requiredMigrationSetSha256: direct.release.requiredMigrationSetSha256,
    appliedMigrationCount: direct.release.appliedMigrationCount,
    appliedRequiredMigrationSetSha256:
      direct.release.appliedRequiredMigrationSetSha256,
    environment: "production",
  };
}

function validateApiHealth(value, expected, stage) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReleaseNotReadyError(stage, "health payload is not an object");
  }
  if (value.status !== "ok" || value.commit !== expected) {
    throw new ReleaseNotReadyError(stage, "health is not serving the expected release");
  }
  const release = value.release;
  if (!release || typeof release !== "object" || Array.isArray(release)) {
    throw new ReleaseNotReadyError(stage, "release readiness is missing");
  }
  if (
    release.schemaVersion !== 1 ||
    release.surface !== "api" ||
    release.artifactHashAlgorithm !== "sha256-manifest-v1"
  ) {
    throw new ReleaseNotReadyError(stage, "release contract identity is incompatible");
  }
  for (const field of ["releaseOrchestrationId", "gitSha"]) {
    if (release[field] !== expected) {
      throw new ReleaseNotReadyError(stage, `${field} does not match the expected release`);
    }
  }
  assertSha256(release.apiArtifactSha256, `${stage} apiArtifactSha256`);
  assertSha256(release.requiredMigrationSetSha256, `${stage} requiredMigrationSetSha256`);
  assertSha256(
    release.appliedRequiredMigrationSetSha256,
    `${stage} appliedRequiredMigrationSetSha256`,
  );
  if (
    release.ready !== true ||
    release.checked !== true ||
    release.manifestReady !== true ||
    release.platformCommitMatches !== true ||
    release.databaseCompatible !== true
  ) {
    throw new ReleaseNotReadyError(stage, "release or database readiness is incomplete");
  }
  if (release.environment !== "production") {
    throw new ReleaseNotReadyError(stage, "release environment is not production");
  }
  if (
    !Number.isInteger(release.requiredMigrationCount) ||
    !Number.isInteger(release.appliedMigrationCount) ||
    !Number.isInteger(release.appliedRequiredMigrationCount) ||
    release.appliedRequiredMigrationCount !== release.requiredMigrationCount ||
    release.appliedMigrationCount < release.requiredMigrationCount ||
    release.appliedRequiredMigrationSetSha256 !== release.requiredMigrationSetSha256
  ) {
    throw new ReleaseNotReadyError(stage, "migration set is incompatible");
  }
  if (!Number.isFinite(Date.parse(release.builtAt))) {
    throw new ReleaseNotReadyError(stage, "API builtAt is invalid");
  }
  return value;
}
