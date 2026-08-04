import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  apiArtifactFiles,
  hashFileManifest,
  listArtifactFiles,
  validateApiReleaseIdentity,
  validateWebReleaseIdentity,
} from "./lib/release-identity.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const surface = process.argv[2];

if (surface === "web") {
  const directory = path.join(repoRoot, "apps/web/dist");
  const manifest = validateWebReleaseIdentity(
    JSON.parse(await readFile(path.join(directory, "release.json"), "utf8")),
  );
  const actual = await hashFileManifest(
    directory,
    await listArtifactFiles(directory, { excludeRelative: ["release.json"] }),
  );
  if (manifest.webArtifactSha256 !== actual) {
    throw new Error("Generated web release identity does not match the built artifact");
  }
} else if (surface === "api") {
  const manifest = validateApiReleaseIdentity(
    JSON.parse(
      await readFile(path.join(repoRoot, "apps/api/.release/release.json"), "utf8"),
    ),
  );
  const actual = await hashFileManifest(repoRoot, await apiArtifactFiles(repoRoot));
  if (manifest.apiArtifactSha256 !== actual) {
    throw new Error("Generated API release identity does not match its artifact inputs");
  }
} else {
  throw new Error("Usage: node scripts/verify-generated-release.mjs <web|api>");
}

console.log(`Verified generated ${surface} release identity`);
