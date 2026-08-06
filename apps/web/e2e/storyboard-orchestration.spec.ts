import { expect, test, type Page, type Route } from "@playwright/test";
import { mockLocalApi, now, workspaceId } from "./fixtures/local-api";

const projectId = "project-storyboard-orchestration";
const runId = "run-storyboard-orchestration";

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function project(brief: boolean) {
  return {
    id: projectId,
    schemaVersion: "project.v1",
    workspaceId,
    name: "Storyboard orchestration",
    status: "active",
    visibility: "private",
    brief: brief
      ? {
          goal: "Turn a product launch into a visual story.",
          oneBigIdea: "The launch unfolds in three clear moments.",
          targetLengthSec: 30,
          aspectRatio: "9:16",
          platform: "general",
        }
      : null,
    currentBriefVersionId: brief ? "brief-storyboard-orchestration" : null,
    hasStoryboard: false,
    posterAssetId: null,
    posterUrl: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function mockProjectOverview(page: Page, hasBrief = true) {
  await mockLocalApi(page);
  await page.route(`**/api/v1/projects/${projectId}`, (route) =>
    json(route, { project: project(hasBrief) }),
  );
  await page.route(`**/api/v1/projects/${projectId}/storyboard`, (route) =>
    json(route, { storyboard: null }),
  );
  await page.route(
    `**/api/v1/projects/${projectId}/generation-entrypoints/storyboard`,
    (route) =>
      route.request().method() === "GET"
        ? json(route, { run: null })
        : route.fallback(),
  );
  await page.route(`**/api/v1/workspaces/${workspaceId}/generation-runs**`, (route) =>
    json(route, { runs: [], pagination: { limit: 6, nextCursor: null } }),
  );
  await page.route(`**/api/v1/workspaces/${workspaceId}/outputs**`, (route) =>
    json(route, { outputs: [], pagination: { limit: 6, nextCursor: null } }),
  );
  await page.route(`**/api/v1/projects/${projectId}/generation-runs/${runId}`, (route) =>
    json(route, {
      run: {
        runId,
        projectId,
        status: "running",
        currentStageType: "brief_intake",
        progressPercent: null,
        message: "Planning scenes and moments.",
        reviewGate: null,
        createdAt: now,
        updatedAt: now,
        startedAt: now,
      },
      stages: [
        {
          stageId: `${runId}:tool:create_or_load_brief`,
          runId,
          type: "brief_intake",
          toolName: "create_or_load_brief",
          label: "Concept",
          order: 0,
          status: "running",
          progressPercent: null,
          message: "Loading the active brief.",
          startedAt: now,
          jobIds: [],
          artifactIds: [],
          createdAt: now,
          updatedAt: now,
        },
      ],
      stageItems: [],
    }),
  );
}

test("Create storyboard starts the orchestrated planning flow and opens its run @mobile", async ({
  page,
}) => {
  await mockProjectOverview(page);
  const requests: string[] = [];
  await page.route(
    `**/api/v1/projects/${projectId}/generation-entrypoints/storyboard`,
    async (route) => {
      if (route.request().method() === "GET") return route.fallback();
      requests.push(route.request().url());
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({});
      await json(route, { runId, reused: false }, 202);
    },
  );

  await page.goto(`/projects/${projectId}`);

  if ((page.viewportSize()?.width ?? 1_024) <= 760) {
    const storyboardDisclosure = page.getByRole("group").filter({ hasText: "Storyboard" });
    await storyboardDisclosure.getByText("Storyboard", { exact: true }).click();
    await expect(
      storyboardDisclosure.getByText(
        "The agent plans scenes and moments before drawing storyboard panels.",
      ),
    ).toBeVisible();
  } else {
    await expect(
      page.getByText(
        "Popcorn Ready plans the scenes and moments, then draws sketch panels for review.",
      ).filter({ visible: true }),
    ).toBeVisible();
  }
  const create = page
    .getByRole("button", { name: "Create storyboard" })
    .filter({ visible: true });
  await expect(create).toBeEnabled();
  await create.click();

  await expect(page).toHaveURL(`/projects/${projectId}/runs/${runId}`);
  await expect(page.getByRole("heading", { name: "Producing Storyboard orchestration" })).toBeVisible();
  expect(requests).toHaveLength(1);
});

test("a project without a brief explains the prerequisite and links to the brief @mobile", async ({
  page,
}) => {
  await mockProjectOverview(page, false);
  let started = false;
  await page.route(
    `**/api/v1/projects/${projectId}/generation-entrypoints/storyboard`,
    async (route) => {
      if (route.request().method() === "GET") return route.fallback();
      started = true;
      await json(route, { error: { code: "brief_missing", message: "Brief missing." } }, 400);
    },
  );

  await page.goto(`/projects/${projectId}`);

  await expect(
    page.getByText(
      (page.viewportSize()?.width ?? 1_024) <= 760
        ? "Finish the brief to create a storyboard."
        : "Finish the project brief before creating a storyboard.",
    ).filter({ visible: true }),
  ).toBeVisible();
  const finishBrief = page.getByRole("link", { name: "Finish brief" }).filter({ visible: true });
  await expect(finishBrief).toHaveAttribute("href", `/projects/${projectId}/brief`);
  await expect(
    page.getByRole("button", { name: "Create storyboard" }).filter({ visible: true }),
  ).toHaveCount(page.viewportSize() && page.viewportSize()!.width > 760 ? 1 : 0);
  expect(started).toBe(false);
});

test("returning while a storyboard-bound production run is active shows progress, not Create @mobile", async ({
  page,
}) => {
  await mockProjectOverview(page);
  let fullHistoryReads = 0;
  await page.route(`**/api/v1/projects/${projectId}/generation-runs`, (route) => {
    fullHistoryReads += 1;
    return json(route, { runs: [] });
  });
  await page.route(`**/api/v1/projects/${projectId}/generation-entrypoints/storyboard`, (route) =>
    json(route, {
      run: {
        runId,
        projectId,
        status: "running",
        currentStageType: "creative_plan",
        progressPercent: null,
        message: "Planning scenes and moments.",
        storyboardBoundaryStatus: "pending",
        reviewGate: null,
        createdAt: now,
        updatedAt: now,
        startedAt: now,
      },
    }),
  );

  await page.goto(`/projects/${projectId}`);

  await expect(
    page.getByRole("button", { name: "Create storyboard" }).filter({ visible: true }),
  ).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 1_024) <= 760) {
    await expect(
      page.getByText("Generating storyboard: preparing scenes.").filter({ visible: true }),
    ).toBeVisible();
  } else {
    await expect(
      page.getByText("Planning scenes and moments…").filter({ visible: true }),
    ).toBeVisible();
  }
  expect(fullHistoryReads).toBe(0);
});

test("returning at script review opens the existing run instead of creating a storyboard @mobile", async ({
  page,
}) => {
  await mockProjectOverview(page);
  const priorAssetRunId = "prior-standalone-video";
  await page.route(`**/api/v1/workspaces/${workspaceId}/generation-runs**`, (route) =>
    json(route, {
      runs: [{
        runId: priorAssetRunId,
        projectId,
        projectName: "Storyboard orchestration",
        status: "failed",
        completionKind: "standalone_asset",
        presentationKind: "standalone_video",
        currentStageType: "asset_generation",
        message: "A prior standalone attempt failed.",
        reviewGate: null,
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        completedAt: now,
      }],
      pagination: { limit: 6, nextCursor: null },
    }),
  );
  await page.route(
    `**/api/v1/projects/${projectId}/generation-runs/${priorAssetRunId}`,
    (route) => json(route, { error: { code: "run_unavailable", message: "Run unavailable." } }, 500),
  );
  await page.route(`**/api/v1/projects/${projectId}/generation-entrypoints/storyboard`, (route) =>
    json(route, {
      run: {
        runId,
        projectId,
        status: "succeeded",
        currentStageType: "script",
        progressPercent: 30,
        message: "Script is ready for review.",
        storyboardBoundaryStatus: "pending",
        reviewGate: {
          stageType: "script",
          stageId: `${runId}:review:after:draft_script`,
          state: "awaiting_review",
          enteredAt: now,
        },
        createdAt: now,
        updatedAt: now,
        startedAt: now,
      },
    }),
  );

  await page.goto(`/projects/${projectId}`);

  await expect(
    page.getByRole("button", { name: "Create storyboard" }).filter({ visible: true }),
  ).toHaveCount(0);
  const reviewScript = page.getByRole("link", { name: "Review script" }).filter({ visible: true });
  await expect(reviewScript).toHaveAttribute("href", `/projects/${projectId}/runs/${runId}`);
  if ((page.viewportSize()?.width ?? 1_024) <= 760) {
    await expect(page.getByText("Script ready for review.").filter({ visible: true })).toBeVisible();
  }
  await expect(
    page.getByRole("button", { name: "Retry asset check" }).filter({ visible: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/generating storyboard/i).filter({ visible: true }),
  ).toHaveCount(0);
});

test("a storyboard-bound run that fails while the project is open becomes retryable @mobile", async ({
  page,
}) => {
  await mockProjectOverview(page);
  let reads = 0;
  await page.route(`**/api/v1/projects/${projectId}/generation-entrypoints/storyboard`, (route) => {
    reads += 1;
    const failed = reads > 1;
    return json(route, {
      run: {
        runId,
        projectId,
        status: failed ? "failed" : "running",
        currentStageType: "creative_plan",
        progressPercent: null,
        message: failed ? "Storyboard planning failed." : "Planning scenes and moments.",
        storyboardBoundaryStatus: "pending",
        reviewGate: null,
        error: failed
          ? { code: "model_output_invalid", message: "Storyboard planning failed.", retryable: true }
          : undefined,
        createdAt: now,
        updatedAt: now,
        startedAt: now,
      },
    });
  });

  await page.goto(`/projects/${projectId}`);
  await expect(
    page.getByRole("button", { name: "Create storyboard" }).filter({ visible: true }),
  ).toHaveCount(0);

  if ((page.viewportSize()?.width ?? 1_024) <= 760) {
    await expect(
      page.getByRole("button", { name: "Retry storyboard workflow" }),
    ).toBeVisible({ timeout: 8_000 });
  } else {
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible({ timeout: 8_000 });
  }
  expect(reads).toBeGreaterThan(1);
});
