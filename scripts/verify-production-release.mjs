import {
  ReleaseNotReadyError,
  readBoundedJsonBody,
  validateJsonResponseMetadata,
  validateProductionOrigin,
  verifyReleaseCoherence,
} from "./lib/production-release-verifier.mjs";

const options = parseArgs(process.argv.slice(2));
const expectedGitSha = options.expected;
const webOrigin = validateProductionOrigin(options.webOrigin, "--web-origin");
const apiOrigin = validateProductionOrigin(options.apiOrigin, "--api-origin");
const deadline = Date.now() + options.timeoutSeconds * 1000;
let lastStage = "startup";

while (Date.now() < deadline) {
  try {
    lastStage = "direct API";
    const directApiHealth = await fetchJson(
      new URL("/api/v1/health", apiOrigin),
      lastStage,
    );
    lastStage = "web release metadata";
    const webRelease = await fetchJson(new URL("/release.json", webOrigin), lastStage);
    lastStage = "same-origin API proxy";
    const proxiedApiHealth = await fetchJson(
      new URL("/api/v1/health", webOrigin),
      lastStage,
    );
    const verified = verifyReleaseCoherence({
      expectedGitSha,
      webRelease,
      directApiHealth,
      proxiedApiHealth,
    });
    console.log(
      `Verified production release ${verified.gitSha}: web/API artifacts are distinct and ${verified.requiredMigrationCount} required migrations are compatible.`,
    );
    process.exit(0);
  } catch (error) {
    if (!(error instanceof ReleaseNotReadyError)) {
      lastStage = "contract validation";
    } else {
      lastStage = error.stage;
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalSeconds * 1000));
  }
}

console.error(`Production release was not coherent before timeout (last stage: ${lastStage}).`);
process.exit(1);

async function fetchJson(url, stage) {
  let response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
  } catch {
    throw new ReleaseNotReadyError(stage, "request failed");
  }
  validateJsonResponseMetadata({
    status: response.status,
    contentType: response.headers.get("content-type"),
    cacheControl: response.headers.get("cache-control"),
  }, stage);
  return readBoundedJsonBody(response, stage);
}

function parseArgs(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("Use --expected, --web-origin, --api-origin, and optional timeout flags");
    }
    values.set(key, value);
  }
  const timeoutSeconds = Number(values.get("--timeout-seconds") ?? 600);
  const intervalSeconds = Number(values.get("--interval-seconds") ?? 10);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 1800) {
    throw new Error("--timeout-seconds must be an integer from 1 to 1800");
  }
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 60) {
    throw new Error("--interval-seconds must be an integer from 1 to 60");
  }
  return {
    expected: values.get("--expected"),
    webOrigin: values.get("--web-origin"),
    apiOrigin: values.get("--api-origin"),
    timeoutSeconds,
    intervalSeconds,
  };
}
