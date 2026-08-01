import { expect, test, type Route } from "@playwright/test";
import { mockLocalApi, now, workspaceId } from "./fixtures/local-api";

async function json(route: Route, body: unknown, status = 200) {
  const origin = route.request().headers().origin;
  await route.fulfill({
    status,
    headers: {
      "access-control-allow-credentials": "true",
      "access-control-allow-origin": origin ?? "*",
      "content-type": "application/json",
      vary: "origin",
    },
    body: JSON.stringify(body),
  });
}

const projectId = "existing-project";

const project = {
  id: projectId,
  schemaVersion: "project.v1",
  workspaceId,
  name: "Upload-more project",
  status: "active",
  visibility: "private",
  brief: {
    goal: "Make a warm launch video from uploaded clips.",
    oneBigIdea: "A launch video assembled from real footage.",
    strongestVisual: "Phone footage of the product in use.",
    targetLengthSec: 30,
    aspectRatio: "9:16",
    format: "short",
    platform: "TikTok",
  },
  currentBriefVersionId: null,
  hasStoryboard: false,
  posterAssetId: null,
  posterUrl: null,
  createdAt: now,
  updatedAt: now,
};

test("project overview presents one-off image activity without a script stage", async ({ page }) => {
  await mockLocalApi(page);
  const standaloneRun = {
    runId: "run_one_off_image",
    projectId,
    status: "succeeded",
    completionKind: "standalone_asset",
    presentationKind: "standalone_image",
    currentStageType: "ready",
    progressPercent: 100,
    message: "Asset is ready.",
    reviewGate: null,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: now,
  };
  const standaloneStage = {
    stageId: "run_one_off_image:tool:generate_image_asset",
    runId: standaloneRun.runId,
    type: "asset_generation",
    toolName: "generate_image_asset",
    label: "Image asset",
    order: 9,
    status: "succeeded",
    progressPercent: 100,
    message: "Image asset applied.",
    startedAt: now,
    completedAt: now,
    jobIds: [],
    artifactIds: ["asset_one_off"],
    createdAt: now,
    updatedAt: now,
  };

  await page.route(`**/api/v1/projects/${projectId}`, (route) =>
    json(route, { project }),
  );
  await page.route(`**/api/v1/projects/${projectId}/storyboard`, (route) =>
    json(route, { storyboard: null }),
  );
  await page.route(`**/api/v1/projects/${projectId}/storyboards/generate`, (route) =>
    json(route, { job: null }),
  );
  await page.route(`**/api/v1/workspaces/${workspaceId}/generation-runs**`, (route) =>
    json(route, { runs: [standaloneRun], pagination: { limit: 6, nextCursor: null } }),
  );
  await page.route(
    `**/api/v1/projects/${projectId}/generation-runs/${standaloneRun.runId}`,
    (route) => json(route, { run: standaloneRun, stages: [standaloneStage], stageItems: [] }),
  );

  await page.goto(`/projects/${projectId}`);

  const panel = page
    .getByRole("heading", { name: "Generation status" })
    .locator("xpath=ancestor::section");
  await expect(page.getByRole("heading", { name: "Generation status" })).toBeVisible();
  await expect(
    panel.getByLabel("Generation stages").getByText("Image asset", { exact: true }),
  ).toBeVisible();
  await expect(panel.getByText("Asset ready", { exact: true })).toBeVisible();
  await expect(panel.getByText("Script", { exact: true })).toHaveCount(0);

  standaloneRun.status = "failed";
  standaloneRun.message = "Generation failed.";
  await page.reload();

  await expect(panel.getByText("Failed", { exact: true })).toBeVisible();
  await expect(panel.getByText("Needs attention", { exact: true })).toBeVisible();
  await expect(
    panel.getByLabel("Generation stages").getByText("Complete", { exact: true }),
  ).toBeVisible();
});

test("project overview upload-more targets the existing project", async ({ page }) => {
  await mockLocalApi(page);

  const createProjectRequests: string[] = [];
  let uploadRequest:
    | {
        url: string;
        body: Record<string, unknown>;
      }
    | null = null;

  await page.route("**/api/v1/projects", async (route) => {
    if (route.request().method() === "POST") {
      createProjectRequests.push(route.request().url());
      await json(route, { error: "unexpected draft creation" }, 500);
      return;
    }
    await route.fallback();
  });

  await page.route(`**/api/v1/projects/${projectId}`, (route) =>
    json(route, { project }),
  );
  await page.route(`**/api/v1/projects/${projectId}/storyboard`, (route) =>
    json(route, { storyboard: null }),
  );
  await page.route(`**/api/v1/projects/${projectId}/storyboards/generate`, (route) =>
    json(route, { job: null }),
  );
  await page.route(`**/api/v1/projects/${projectId}/uploads`, async (route) => {
    uploadRequest = {
      url: route.request().url(),
      body: route.request().postDataJSON() as Record<string, unknown>,
    };
    await json(route, {
      asset: {
        id: "asset_second_image",
        schemaVersion: "asset.v1",
        workspaceId,
        projectId,
        kind: "image",
        status: "ready",
        filename: "second.png",
        url: "https://example.invalid/second.png",
        durationSec: 4,
        source: "upload",
        createdAt: now,
        updatedAt: now,
      },
      job: {
        id: "job_upload_second",
        type: "asset_upload",
        status: "succeeded",
        createdAt: now,
        updatedAt: now,
      },
    });
  });

  await page.goto(`/projects/${projectId}`);

  await expect(page.getByRole("heading", { name: project.name })).toBeVisible();

  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles({
    name: "second.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lFKV8QAAAABJRU5ErkJggg==",
      "base64",
    ),
  });

  await expect.poll(() => uploadRequest?.url ?? "").toContain(
    `/api/v1/projects/${projectId}/uploads`,
  );
  expect(createProjectRequests).toEqual([]);
  expect(uploadRequest?.body).toMatchObject({
    kind: "image",
    filename: "second.png",
    durationSec: 4,
    userContext: {
      description: "Added from the project dashboard: second.png",
      intendedUse: ["primary_footage"],
    },
  });
});
