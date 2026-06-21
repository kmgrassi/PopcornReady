import { expect, test, type Page } from "@playwright/test";

const projectId = "project-progress-e2e";
const runId = "run-progress-e2e";
const now = "2026-06-16T12:00:00.000Z";
const runPath = `/projects/${projectId}/runs/${runId}`;
const apiRunPath = `/api/v1/projects/${projectId}/generation-runs/${runId}`;
const lastRunHintKey = `popcornReady:lastRunHint:${projectId}`;

type RunStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";
type StageType =
  | "brief_intake"
  | "creative_plan"
  | "storyboard"
  | "asset_generation"
  | "audio_generation"
  | "timeline_assembly"
  | "quality_review"
  | "export";

interface MockRunOptions {
  status?: RunStatus;
  stageType?: StageType;
  progressPercent?: number;
  message?: string;
  stageItems?: Array<Record<string, unknown>>;
  reviewGate?: null | {
    stageType: StageType;
    stageId: string;
    state: "awaiting_review";
    enteredAt: string;
  };
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
  };
}

test.beforeEach(async ({ page }) => {
  await mockLocalAuth(page);
  await mockProject(page);
});

test("polls an active run, cancels it, and clears the recovery hint", async ({ page }) => {
  let getCount = 0;
  let canceled = false;
  let cancelRequestBody: unknown = null;

  await page.route(`**${apiRunPath}`, async (route) => {
    if (canceled) {
      await route.fulfill({
        json: runDetail({
          status: "canceled",
          stageType: "asset_generation",
          progressPercent: 58,
          message: "Generation was canceled.",
        }),
      });
      return;
    }
    getCount += 1;
    await route.fulfill({
      json: runDetail({
        status: "running",
        stageType: "asset_generation",
        progressPercent: getCount === 1 ? 42 : 58,
        message: getCount === 1 ? "Generating shot candidates." : "Refining shot candidates.",
      }),
    });
  });
  await page.route(`**${apiRunPath}/cancel`, async (route) => {
    canceled = true;
    cancelRequestBody = await route.request().postDataJSON();
    await route.fulfill({
      json: runDetail({
        status: "canceled",
        stageType: "asset_generation",
        progressPercent: 58,
        message: "Generation was canceled.",
      }),
    });
  });

  await page.goto(runPath);

  await expect(page.getByRole("heading", { name: "Stop here or keep producing" })).toBeVisible();
  const overallProgress = page.getByRole("progressbar", { name: /complete/ });
  await expect(overallProgress).toHaveAttribute("aria-valuenow", "42");
  await expect
    .poll(() => overallProgress.getAttribute("aria-valuenow"))
    .toBe("58");

  await expect(page.getByRole("button", { name: "Stop here" })).toBeVisible();
  await expect
    .poll(() => page.evaluate((key) => sessionStorage.getItem(key), lastRunHintKey))
    .toContain(`"status":"running"`);

  await page.getByRole("button", { name: "Stop here" }).click();

  await expect(page.getByText("Run canceled")).toBeVisible();
  expect(cancelRequestBody).toEqual({});
  await expect
    .poll(() => page.evaluate((key) => sessionStorage.getItem(key), lastRunHintKey))
    .toBeNull();
});

test("shows in-progress rail state when active stage rows have not caught up", async ({ page }) => {
  const detail = runDetail({
    status: "running",
    stageType: "asset_generation",
    progressPercent: 46,
    message: "Generating shot candidates.",
  });
  detail.stages = detail.stages.map((stage) =>
    stage.type === "asset_generation"
      ? {
          ...stage,
          status: "queued",
          progressPercent: 0,
          message: undefined,
          startedAt: undefined,
        }
      : stage,
  );

  await page.route(`**${apiRunPath}`, async (route) => {
    await route.fulfill({ json: detail });
  });

  await page.goto(runPath);

  const rail = page.getByRole("complementary", { name: "Stage rail" });
  await expect(rail.getByText("Pipeline")).toBeVisible();
  await expect(rail.getByText("In progress")).toBeVisible();
  await expect(rail.getByText("Generating shot candidates.")).toBeVisible();
  await expect(rail.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "46");
  await expect(rail.getByText("Shots")).toBeVisible();
});

test("opens generated asset feedback in a modal and posts the targeted revision", async ({ page }) => {
  let revisionRequestBody: unknown = null;
  let getCount = 0;
  let detail = runDetail({
    status: "running",
    stageType: "audio_generation",
    progressPercent: 85,
    message: "Audio is ready for feedback.",
    stageItems: [
      {
        itemId: "item-score-1",
        stageId: "stage-audio_generation",
        kind: "audio",
        purpose: "audio",
        label: "Score bed",
        status: "succeeded",
        provider: "fixture",
        promptPreview: "Warm cinematic score.",
        assetId: "asset-score-1",
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
  await page.route(`**${apiRunPath}`, async (route) => {
    getCount += 1;
    await route.fulfill({ json: detail });
  });
  await page.route(`**${apiRunPath}/board-revisions`, async (route) => {
    revisionRequestBody = await route.request().postDataJSON();
    detail = runDetail({
      status: "running",
      stageType: "audio_generation",
      progressPercent: 88,
      message: "Revision is running.",
      stageItems: detail.stageItems,
    });
    await route.fulfill({
      json: {
        revision: {
          id: "revision-1",
          message: "Make the score less dramatic.",
          target: {
            scope: "tile",
            runId,
            stageId: "stage-audio_generation",
            itemId: "item-score-1",
            assetId: "asset-score-1",
            label: "Score bed",
          },
          createdAt: now,
        },
      },
    });
  });

  await page.goto(runPath);

  await expect(page.getByRole("heading", { name: "Generated assets" })).toBeVisible();
  await expect(page.getByPlaceholder("Tell the AI what to change here.")).toHaveCount(0);

  await page.getByRole("button", { name: "Edit Score bed with AI" }).click();
  const dialog = page.getByRole("dialog", { name: "Score bed" });
  await expect(dialog).toBeVisible();

  const feedback = dialog.getByLabel("Feedback for the AI");
  await feedback.fill("Make the score less dramatic.");
  await expect.poll(() => getCount).toBeGreaterThan(1);
  await expect(dialog).toBeVisible();
  await expect(feedback).toHaveValue("Make the score less dramatic.");

  await dialog.getByRole("button", { name: "Send to AI" }).click();

  await expect(dialog).toHaveCount(0);
  await expect.poll(() => getCount).toBeGreaterThan(2);
  await expect(page.getByText("Revision is running.")).toBeVisible();
  expect(revisionRequestBody).toEqual({
    message: "Make the score less dramatic.",
    target: {
      scope: "tile",
      runId,
      stageId: "stage-audio_generation",
      itemId: "item-score-1",
      assetId: "asset-score-1",
      label: "Score bed",
    },
  });
});

test("submits review-gate approve and reject actions with notes", async ({ page }) => {
  const requests: Array<{ action: string; body: unknown }> = [];
  let detail = runDetail({
    status: "running",
    stageType: "storyboard",
    progressPercent: 35,
    reviewGate: {
      stageId: "stage-storyboard",
      stageType: "storyboard",
      state: "awaiting_review",
      enteredAt: now,
    },
    message: "Storyboard is ready for review.",
  });

  await page.route(`**${apiRunPath}`, async (route) => {
    await route.fulfill({ json: detail });
  });
  await page.route(`**${apiRunPath}/approve`, async (route) => {
    requests.push({ action: "approve", body: await route.request().postDataJSON() });
    detail = runDetail({
      status: "running",
      stageType: "asset_generation",
      progressPercent: 45,
      message: "Visuals are in progress.",
    });
    await route.fulfill({ json: detail });
  });
  await page.route(`**${apiRunPath}/reject`, async (route) => {
    requests.push({ action: "reject", body: await route.request().postDataJSON() });
    detail = runDetail({
      status: "running",
      stageType: "storyboard",
      progressPercent: 35,
      reviewGate: {
        stageId: "stage-storyboard",
        stageType: "storyboard",
        state: "awaiting_review",
        enteredAt: now,
      },
      message: "Regenerating storyboard with feedback.",
    });
    await route.fulfill({ json: detail });
  });

  await page.goto(runPath);

  await expect(page.getByText("Needs review")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve and continue" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request changes" })).toBeVisible();

  await page.getByLabel("Feedback").fill("Keep the close-up, simplify the transition.");
  await page.getByRole("button", { name: "Approve and continue" }).click();

  await expect(page.getByLabel("Feedback")).toBeHidden();
  await expect(page.getByText("Visuals are in progress.")).toBeVisible();
  expect(requests).toContainEqual({
    action: "approve",
    body: { note: "Keep the close-up, simplify the transition." },
  });

  detail = runDetail({
    status: "running",
    stageType: "storyboard",
    progressPercent: 35,
    reviewGate: {
      stageId: "stage-storyboard",
      stageType: "storyboard",
      state: "awaiting_review",
      enteredAt: now,
    },
    message: "Storyboard is ready for review.",
  });
  await page.reload();
  await page.getByLabel("Feedback").fill("Make the ending less busy.");
  await page.getByRole("button", { name: "Request changes" }).click();

  await expect(page.getByLabel("Feedback")).toHaveValue("");
  await expect(page.getByText("Needs review")).toBeVisible();
  expect(requests).toContainEqual({
    action: "reject",
    body: { stageType: "storyboard", note: "Make the ending less busy." },
  });
});

test("shows a stored recovery hint while loading and then renders failure details", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key, value }) => {
      sessionStorage.setItem(key, JSON.stringify(value));
    },
    {
      key: lastRunHintKey,
      value: {
        runId,
        status: "running",
        updatedAt: now,
      },
    },
  );

  let fulfillRun: ((value?: unknown) => void) | null = null;
  const runResponse = new Promise((resolve) => {
    fulfillRun = resolve;
  });

  await page.route(`**${apiRunPath}`, async (route) => {
    await runResponse;
    await route.fulfill({
      json: runDetail({
        status: "failed",
        stageType: "timeline_assembly",
        progressPercent: 64,
        message: "Timeline assembly failed.",
        error: {
          code: "timeline_assembly_failed",
          message: "Could not assemble the deterministic timeline.",
          retryable: true,
        },
      }),
    });
  });

  await page.goto(`${runPath}?studioDraft=draft-123`);

  await expect(page.getByRole("heading", { name: "Opening production workspace" })).toBeVisible();
  await expect(page.getByText(`Last seen run ${runId} was running.`)).toBeVisible();

  fulfillRun?.();

  await expect(page.getByText("Generation failed")).toBeVisible();
  await expect(
    page.getByRole("alert").getByText("Could not assemble the deterministic timeline."),
  ).toBeVisible();
  await expect(page.getByText("timeline_assembly_failed")).toBeVisible();
  // The Studio route was retired; the recovery link now returns to the project.
  await expect(page.getByRole("link", { name: "Open project" })).toHaveAttribute(
    "href",
    `/projects/${projectId}`,
  );
});

async function mockLocalAuth(page: Page) {
  await page.route("**/api/v1/me", async (route) => {
    await route.fulfill({
      json: {
        actor: {
          id: "dev-user",
          type: "local",
          email: "dev@popcornready.test",
        },
        workspaceId: "dev_workspace",
        workspaceName: "Development workspace",
        authMode: "local",
        isLocal: true,
      },
    });
  });
}

async function mockProject(page: Page) {
  await page.route(`**/api/v1/projects/${projectId}`, async (route) => {
    await route.fulfill({
      json: {
        project: {
          id: projectId,
          schemaVersion: 1,
          workspaceId: "dev_workspace",
          name: "Progress E2E project",
          status: "active",
          visibility: "private",
          brief: {
            goal: "Show the progress flow",
            targetLengthSec: 30,
            aspectRatio: "9:16",
            platform: "tiktok",
            format: "visual_reveal",
            audience: "Producers",
            style: "fast-paced social ad",
            hookQuestion: "Can the run finish cleanly?",
            oneBigIdea: "Progress stays tied to Studio.",
            strongestVisual: "A stage rail advancing through production.",
            payoff: "The cut is ready for review.",
            caveat: "",
          },
          currentBriefVersionId: null,
          hasStoryboard: false,
          posterAssetId: null,
          posterUrl: null,
          createdAt: now,
          updatedAt: now,
        },
      },
    });
  });
}

function runDetail(options: MockRunOptions = {}) {
  const stageType = options.stageType ?? "asset_generation";
  const stageId = `stage-${stageType}`;
  return {
    run: {
      runId,
      projectId,
      status: options.status ?? "running",
      reviewGate: options.reviewGate ?? null,
      currentStageType: stageType,
      progressPercent: options.progressPercent ?? 25,
      message: options.message ?? "Generating your video.",
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      completedAt:
        options.status === "failed" || options.status === "canceled" || options.status === "succeeded"
          ? now
          : undefined,
      error: options.error,
    },
    stages: buildStages(stageType, {
      status: options.status ?? "running",
      reviewStageId: options.reviewGate?.stageId,
      error: options.error,
    }),
    stageItems:
      options.stageItems ??
      (options.reviewGate
        ? [
            {
              itemId: "item-storyboard-1",
              stageId: options.reviewGate.stageId,
              kind: "image",
              purpose: "storyboard_frame",
              label: "Opening storyboard frame",
              status: "succeeded",
              provider: "fixture",
              promptPreview: "Opening frame for review.",
              createdAt: now,
              updatedAt: now,
            },
          ]
        : []),
  };
}

function buildStages(
  activeType: StageType,
  options: {
    status: RunStatus;
    reviewStageId?: string;
    error?: MockRunOptions["error"];
  },
) {
  const stageTypes: StageType[] = [
    "brief_intake",
    "creative_plan",
    "storyboard",
    "asset_generation",
    "audio_generation",
    "timeline_assembly",
    "quality_review",
    "export",
  ];
  const activeIndex = stageTypes.indexOf(activeType);

  return stageTypes.map((type, index) => {
    const stageId = `stage-${type}`;
    const isActive = type === activeType;
    const status =
      options.reviewStageId === stageId
        ? "succeeded"
        : isActive
          ? options.status
          : index < activeIndex
            ? "succeeded"
            : "queued";
    return {
      stageId,
      runId,
      type,
      label: type,
      order: index,
      status,
      isReviewGate: options.reviewStageId === stageId,
      reviewedAt: null,
      progressPercent: status === "succeeded" ? 100 : status === "running" ? 50 : 0,
      message: isActive ? "Stage is active." : undefined,
      startedAt: index <= activeIndex ? now : undefined,
      completedAt: status === "succeeded" || status === "failed" || status === "canceled" ? now : undefined,
      jobIds: [],
      artifactIds: [],
      createdAt: now,
      updatedAt: now,
      error: isActive ? options.error : undefined,
    };
  });
}
