import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mockLocalApi } from "./fixtures/local-api";

test.skip(
  process.env.POPCORN_E2E_PRODUCTION_BUILD !== "true",
  "Run through test:e2e:production-build so the immutable dist manifest exists.",
);

test("production build emits release identity and excludes development routes", async ({
  page,
  request,
}) => {
  execFileSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../../../scripts/verify-generated-release.mjs", import.meta.url),
      ),
      "web",
    ],
    { stdio: "pipe" },
  );
  const releaseResponse = await request.get("/release.json");
  expect(releaseResponse.ok()).toBe(true);
  expect(releaseResponse.headers()["content-type"]).toContain("application/json");
  const release = await releaseResponse.json();
  expect(release).toMatchObject({
    schemaVersion: 1,
    surface: "web",
    artifactHashAlgorithm: "sha256-manifest-v1",
    releaseOrchestrationId: expect.stringMatching(/^[0-9a-f]{40}$/),
    gitSha: expect.stringMatching(/^[0-9a-f]{40}$/),
    webArtifactSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
  });

  await mockLocalApi(page);
  await page.goto("/dev/design-system");
  await expect(page.getByRole("heading", { name: "Popcorn Ready" })).toBeVisible();
  await expect(page.locator("body")).toContainText("Not found");
});
