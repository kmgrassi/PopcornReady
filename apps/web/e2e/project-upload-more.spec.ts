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

test("project overview keeps a completed one-off video viewable after the run fails @mobile", async ({ page }) => {
  await mockLocalApi(page);
  const standaloneRun = {
    runId: "run_one_off_video",
    projectId,
    status: "succeeded",
    completionKind: "standalone_asset",
    presentationKind: "standalone_video",
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
    stageId: "run_one_off_video:tool:generate_video_asset",
    runId: standaloneRun.runId,
    type: "asset_generation",
    toolName: "generate_video_asset",
    label: "Video asset",
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
  const readyAssetItem = {
    itemId: "action_one_off_video:asset_one_off_video",
    stageId: standaloneStage.stageId,
    kind: "video",
    purpose: "asset",
    label: "Rainy street cyclist",
    status: "succeeded",
    assetId: "asset_one_off_video",
    artifactId: "asset_one_off_video",
    createdAt: now,
    updatedAt: now,
  };
  const newerActiveRun = {
    runId: "run_newer_full_video",
    projectId,
    status: "running",
    currentStageType: "creative_plan",
    progressPercent: 20,
    message: "Planning a newer full video.",
    reviewGate: null,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
  };
  const newerActiveStage = {
    stageId: "run_newer_full_video:tool:create_project_plan",
    runId: newerActiveRun.runId,
    type: "creative_plan",
    toolName: "create_project_plan",
    label: "Creative plan",
    order: 1,
    status: "running",
    message: "Planning.",
    startedAt: now,
    jobIds: [],
    artifactIds: [],
    createdAt: now,
    updatedAt: now,
  };
  const newerEmptyStandaloneRun = {
    runId: "run_newer_empty_video_asset",
    projectId,
    status: "failed",
    completionKind: "standalone_asset",
    presentationKind: "standalone_video",
    currentStageType: "asset_generation",
    message: "The newer asset attempt ended before saving media.",
    reviewGate: null,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: now,
    error: {
      code: "provider_failed",
      message: "No media was saved.",
      retryable: true,
    },
  };
  let projectRuns: Array<Record<string, unknown>> = [standaloneRun];
  let standaloneDetailRequests = 0;

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
    json(route, { runs: projectRuns, pagination: { limit: 6, nextCursor: null } }),
  );
  await page.route(
    `**/api/v1/projects/${projectId}/generation-runs/${standaloneRun.runId}`,
    (route) => {
      standaloneDetailRequests += 1;
      const firstPollIsActive = standaloneDetailRequests === 1;
      return json(route, {
        run: firstPollIsActive
          ? {
              ...standaloneRun,
              status: "running",
              progressPercent: 85,
              message: "Finishing the asset.",
              completedAt: undefined,
            }
          : standaloneRun,
        stages: firstPollIsActive
          ? [{ ...standaloneStage, status: "running", progressPercent: 85, completedAt: undefined }]
          : [standaloneStage],
        stageItems: firstPollIsActive ? [] : [readyAssetItem],
      });
    },
  );
  await page.route(
    `**/api/v1/projects/${projectId}/generation-runs/${newerActiveRun.runId}`,
    (route) => json(route, {
      run: newerActiveRun,
      stages: [newerActiveStage],
      stageItems: [],
    }),
  );
  await page.route(
    `**/api/v1/projects/${projectId}/generation-runs/${newerEmptyStandaloneRun.runId}`,
    (route) => json(route, {
      run: newerEmptyStandaloneRun,
      stages: [],
      stageItems: [],
    }),
  );

  await page.goto(`/projects/${projectId}`);

  const assetPath =
    `/library/assets?assetId=asset_one_off_video&projectId=${projectId}`;
  const mobile = Boolean(page.viewportSize() && page.viewportSize()!.width <= 760);
  const panel = page
    .getByRole("heading", { name: "Generation status" })
    .locator("xpath=ancestor::section");
  if (mobile) {
    const statusRegion = page.getByLabel("Project status");
    await expect(statusRegion.getByText("Video asset ready to view.")).toBeVisible();
    await expect(statusRegion.getByRole("link", { name: "View video asset" })).toHaveAttribute(
      "href",
      assetPath,
    );
  } else {
    await expect(page.getByRole("heading", { name: "Generation status" })).toBeVisible();
    await expect(
      panel.getByLabel("Generation stages").getByText("Video asset", { exact: true }),
    ).toBeVisible();
    await expect(panel.getByText("Asset ready", { exact: true })).toBeVisible();
    await expect(panel.getByText("Script", { exact: true })).toHaveCount(0);
    await expect(panel.getByRole("link", { name: "View video asset" })).toHaveAttribute(
      "href",
      assetPath,
    );
    await expect(page.locator("header").getByRole("link", { name: "View video asset" })).toHaveAttribute(
      "href",
      assetPath,
    );
  }
  await expect(page.getByRole("link", { name: "Watch" })).toHaveCount(0);

  standaloneRun.status = "failed";
  standaloneRun.message = "Generation failed.";
  projectRuns = [newerActiveRun, newerEmptyStandaloneRun, standaloneRun];
  await page.reload();

  if (mobile) {
    const statusRegion = page.getByLabel("Project status");
    await expect(statusRegion.getByText("Video asset ready to view.")).toBeVisible();
    await expect(statusRegion.getByRole("link", { name: "View video asset" })).toHaveAttribute(
      "href",
      assetPath,
    );
  } else {
    const activePanel = page
      .getByRole("heading", { name: "Stage and next step" })
      .locator("xpath=ancestor::section");
    await expect(activePanel.getByText("Creative Plan", { exact: true }).first()).toBeVisible();
    await expect(activePanel.getByRole("link", { name: "View video asset" })).toHaveAttribute(
      "href",
      assetPath,
    );
  }
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
