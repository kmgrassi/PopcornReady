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
  operatorDiagnostics?: Array<Record<string, unknown>>;
  completionKind?: "video" | "storyboard_assets" | "standalone_asset";
  presentationKind?: "standalone_image" | "standalone_video" | "standalone_audio";
  hierarchy?: Record<string, unknown>;
}

test.beforeEach(async ({ page }) => {
  await mockLocalAuth(page);
  await mockProject(page);
});

test("shows Creative Director and specialist lanes instead of the primitive pipeline @mobile", async ({
  page,
}) => {
  await page.route(`**${apiRunPath}`, async (route) => {
    await route.fulfill({
      json: runDetail({
        status: "running",
        message: "Generating shots.",
        hierarchy: hierarchyFixture(),
      }),
    });
  });

  await page.goto(runPath);

  await expect(page.getByRole("heading", { name: "Creative Director" })).toBeVisible();
  await expect(page.getByText("The creative director is guiding this production.", { exact: true })).toBeVisible();
  await expect(page.getByText("Visuals", { exact: true })).toBeVisible();
  await expect(page.getByText("Creating the planned picture and motion.")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Visuals 3 of 6 ready" })).toBeVisible();
  await expect(page.getByText("Audio", { exact: true })).toBeVisible();
  await expect(page.getByText("All assigned work is complete.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open project assets" })).toHaveAttribute(
    "href",
    `/projects/${projectId}/media`,
  );
  await expect(page.getByText(/tool steps complete/i)).toHaveCount(0);
  await expect(page.getByText("Pipeline", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Tool activity", { exact: true })).toHaveCount(0);
  await expect(page.getByText("session-visuals", { exact: false })).toHaveCount(0);

  const audioLane = page.locator("details").filter({ hasText: "Audio" }).first();
  await expect(audioLane).not.toHaveAttribute("open", "");
  await audioLane.locator("summary").first().click();
  await expect(audioLane.getByText("Show production details")).toBeVisible();

  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBe(overflow.clientWidth);
});

test("keeps a specialist question owned by the director and explains blocked work @mobile", async ({
  page,
}) => {
  const hierarchy = hierarchyFixture();
  hierarchy.root.state = "waiting";
  hierarchy.root.needsDirectorDecision = true;
  hierarchy.root.message = "The creative director is resolving a specialist question.";
  hierarchy.sessions[0]!.state = "blocked";
  hierarchy.sessions[0]!.runs[0]!.state = "blocked";
  hierarchy.sessions[0]!.runs[0]!.report = { outcome: "blocked", outputAssetIds: [] };
  hierarchy.sessions[1]!.state = "queued";
  hierarchy.sessions[1]!.runs[0]!.state = "queued";
  hierarchy.sessions[1]!.runs[0]!.report = null;

  await page.route(`**${apiRunPath}`, async (route) => {
    await route.fulfill({ json: runDetail({ status: "running", hierarchy }) });
  });
  await page.goto(runPath);

  await expect(page.getByText("Resolving a specialist question", { exact: true })).toBeVisible();
  await expect(page.getByText("The director is resolving a missing dependency.")).toBeVisible();
  await expect(page.getByText("Ready when the current work allows it.")).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /answer/i })).toHaveCount(0);
});

test("updates specialist lanes when the run poll returns newer hierarchy state", async ({ page }) => {
  let requests = 0;
  await page.route(`**${apiRunPath}`, async (route) => {
    requests += 1;
    const hierarchy = hierarchyFixture();
    if (requests === 1) {
      hierarchy.sessions[0]!.state = "queued";
      hierarchy.sessions[0]!.runs[0]!.state = "queued";
      hierarchy.sessions[0]!.runs[0]!.actions[0]!.state = "queued";
      hierarchy.sessions[0]!.runs[0]!.actions[0]!.jobs[0]!.state = "queued";
      hierarchy.sessions[0]!.runs[0]!.actions[0]!.jobs[0]!.completedItems = 0;
    }
    await route.fulfill({ json: runDetail({ status: "running", hierarchy }) });
  });

  await page.goto(runPath);
  await expect(page.getByText("Ready when the current work allows it.")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Visuals 3 of 6 ready" })).toBeVisible({
    timeout: 5_000,
  });
  expect(requests).toBeGreaterThanOrEqual(2);
});

test("shows a completed one-off image as one asset step without video stages @mobile", async ({ page }) => {
  await page.route(`**${apiRunPath}`, async (route) => {
    await route.fulfill({
      json: runDetail({
        status: "succeeded",
        stageType: "asset_generation",
        completionKind: "standalone_asset",
        presentationKind: "standalone_image",
        message: "Asset is ready.",
      }),
    });
  });

  await page.goto(runPath);

  await expect(page.getByText("Your asset is ready", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Image asset for/ })).toBeVisible();
  await expect(page.getByText(/This one-off asset and its generation history/)).toBeVisible();
  await expect(page.getByText("Unified workspace", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/^Producing /)).toHaveCount(0);
  const rail = await getVisibleStageRail(page);
  await expect(rail.getByText("Asset activity", { exact: true })).toBeVisible();
  await expect(rail.getByText("Pipeline", { exact: true })).toHaveCount(0);
  await expect(rail.getByText("Image asset", { exact: true })).toBeVisible();
  await expect(rail.getByText("Complete", { exact: true })).toBeVisible();
  await expect(rail.getByText("Script", { exact: true })).toHaveCount(0);
  await expect(rail.getByText("Brief", { exact: true })).toHaveCount(0);
  await expect(rail.getByText("Storyboard", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Shots", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Visuals needs attention/i)).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 1_024) <= 760) {
    await expect(page.getByText("Last completed: Image asset", { exact: true })).toBeVisible();
  } else {
    await expect(
      page.getByLabel("Current run status").getByText("Image asset", { exact: true }),
    ).toBeVisible();
  }
});

test("legacy poster work is shown as Poster and never backfills Brief or Script @mobile", async ({
  page,
}) => {
  await page.route(`**${apiRunPath}`, async (route) => {
    await route.fulfill({
      json: {
        run: {
          runId,
          projectId,
          status: "canceled",
          currentStageType: "creative_plan",
          progressPercent: 100,
          message: "Generation was canceled.",
          reviewGate: null,
          createdAt: now,
          updatedAt: now,
          startedAt: now,
          completedAt: now,
        },
        stages: [
          {
            stageId: `${runId}:tool:create_or_load_brief`,
            runId,
            type: "brief_intake",
            toolName: "create_or_load_brief",
            label: "Concept",
            order: 0,
            status: "succeeded",
            progressPercent: 100,
            message: "Brief loaded.",
            startedAt: now,
            completedAt: now,
            jobIds: [],
            artifactIds: ["brief_asset"],
            createdAt: now,
            updatedAt: now,
          },
          {
            stageId: `${runId}:tool:generate_poster`,
            runId,
            type: "creative_plan",
            toolName: "generate_poster",
            label: "Poster",
            order: 1,
            status: "succeeded",
            progressPercent: 100,
            message: "Poster ready.",
            startedAt: now,
            completedAt: now,
            jobIds: [],
            artifactIds: ["poster_asset"],
            createdAt: now,
            updatedAt: now,
          },
        ],
        stageItems: [],
      },
    });
  });

  await page.goto(runPath);

  const rail = await getVisibleStageRail(page);
  await expect(rail.getByText("Poster", { exact: true })).toBeVisible();
  const posterStage = rail.locator("li").filter({ hasText: "Poster" }).first();
  await posterStage.getByText("Tool activity", { exact: true }).click();
  await expect(posterStage.getByText("Generate poster", { exact: true })).toBeVisible();
  await expect(rail.getByText("Brief", { exact: true })).toHaveCount(0);
  await expect(rail.getByText("Script", { exact: true })).toHaveCount(0);
  if ((page.viewportSize()?.width ?? 1_024) <= 760) {
    await expect(page.getByText("Last completed: Poster", { exact: true })).toBeVisible();
  } else {
    await expect(
      page.getByLabel("Current run status").getByText("Poster", { exact: true }),
    ).toBeVisible();
  }
});

async function getVisibleStageRail(page: Page) {
  const visibleRail = page
    .getByRole("complementary", { name: "Stage rail" })
    .filter({ visible: true });
  if (
    await visibleRail
      .first()
      .getByText(/^(Pipeline|Asset activity)$/)
      .isVisible()
      .catch(() => false)
  ) {
    return visibleRail.first();
  }

  const summaryToggle = page
    .locator("summary")
    .filter({ hasText: /Show (pipeline|asset status)/ })
    .filter({ visible: true });
  if ((await summaryToggle.count()) > 0) {
    await summaryToggle.first().click();
  } else {
    await page.getByText(/Show (pipeline|asset status)/).filter({ visible: true }).first().click();
  }

  await expect(visibleRail.first().getByText(/^(Pipeline|Asset activity)$/)).toBeVisible();
  return visibleRail.first();
}

async function fillReviewFeedback(page: Page, note: string) {
  const feedback = page.getByLabel("Feedback");
  await expect(feedback).toBeVisible();
  await feedback.fill(note);
}

test("polls an active run, cancels it, and clears the recovery hint @mobile", async ({ page }) => {
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

  await expect(page.getByRole("heading", { name: "Stop here or keep producing" })).toHaveCount(0);
  const overallProgress = page
    .getByLabel("Current run status")
    .getByRole("progressbar");
  await expect(overallProgress).toBeVisible();
  await expect
    .poll(() => overallProgress.getAttribute("aria-valuenow"))
    .toBe("58");

  const rail = await getVisibleStageRail(page);
  await expect(rail.getByText("Shots")).toBeVisible();
  await expect(rail.getByText("In progress")).toBeVisible();
  await expect(rail.getByRole("button", { name: "Stop here" })).toBeVisible();
  await expect
    .poll(() => page.evaluate((key) => sessionStorage.getItem(key), lastRunHintKey))
    .toContain(`"status":"running"`);

  await rail.getByRole("button", { name: "Stop here" }).click();

  await expect(page.getByText("Run canceled")).toBeVisible();
  expect(cancelRequestBody).toEqual({});
  await expect
    .poll(() => page.evaluate((key) => sessionStorage.getItem(key), lastRunHintKey))
    .toBeNull();
});

test("shows choosing-next-step state when no action is explicitly running @mobile", async ({ page }) => {
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

  const statusPanel = page.getByLabel("Current run status");
  await expect(statusPanel.getByText("Choosing the next step.", { exact: true })).toBeVisible();
  await expect(statusPanel.getByText("Generating shot candidates.", { exact: true })).toHaveCount(0);
  const rail = await getVisibleStageRail(page);
  await expect(rail.getByText("In progress")).toHaveCount(0);
  await expect(rail.getByRole("progressbar")).toHaveCount(0);
  await expect(rail.getByText("Shots")).toBeVisible();
});

test("keeps grouped progress indeterminate and shows truthful job activity @mobile", async ({ page }) => {
  const detail = runDetail({
    status: "running",
    stageType: "asset_generation",
    progressPercent: 72,
    message: "Generating shots.",
  });
  const assetStage = detail.stages.find((stage) => stage.type === "asset_generation")!;
  detail.stages = [
    ...detail.stages.filter((stage) => stage.type !== "asset_generation"),
    {
      ...assetStage,
      stageId: "stage-generate-anchor",
      toolName: "generate_anchor",
      label: "Generate anchor images",
      status: "succeeded",
      progressPercent: 100,
      completedAt: now,
    },
    {
      ...assetStage,
      stageId: "stage-generate-keyframe",
      toolName: "generate_keyframe",
      label: "Generate keyframes",
      status: "running",
      progressPercent: undefined,
      message: "Generating the next keyframe.",
      jobActivities: [
        {
          status: "running",
          currentStep: "generate_keyframe",
          providerLabel: "OpenAI",
          completedItems: 3,
          totalItems: 6,
          currentItemLabel: "Rooftop reveal",
          startedAt: now,
          heartbeatAt: now,
          lastProgressAt: now,
          attentionState: "slow",
        },
      ],
    },
  ];

  await page.route(`**${apiRunPath}`, async (route) => {
    await route.fulfill({ json: detail });
  });
  await page.goto(runPath);

  const rail = await getVisibleStageRail(page);
  const shots = rail.locator("li").filter({ hasText: "Shots" }).first();
  await expect(shots.getByText("In progress")).toBeVisible();
  await expect(shots.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow", /.+/);
  await expect(shots.getByRole("progressbar")).toHaveAttribute(
    "aria-label",
    "Shots in progress; percentage unavailable",
  );
  await expect(
    shots.getByText(
      "This is taking longer than usual. Popcorn Ready is still waiting for an update.",
    ),
  ).toBeVisible();
  await expect(shots.getByText("3 of 6 complete · Rooftop reveal · OpenAI")).toBeVisible();
  await expect(shots.getByText(/job-/)).toHaveCount(0);
});

test("does not turn sweeper updates into false creator activity @mobile", async ({ page }) => {
  const detail = runDetail({
    status: "running",
    stageType: "asset_generation",
    progressPercent: undefined,
    message: "Waiting for the image provider.",
  });
  const assetStage = detail.stages.find((stage) => stage.type === "asset_generation")!;
  detail.run.updatedAt = new Date().toISOString();
  detail.run.lastProgressAt = undefined;
  assetStage.progressPercent = undefined;
  assetStage.jobActivities = [
    {
      status: "running",
      currentStep: "generate_anchor",
      providerLabel: "OpenAI",
      startedAt: now,
      heartbeatAt: new Date().toISOString(),
      attentionState: "slow",
    },
  ];

  await page.route(`**${apiRunPath}`, async (route) => {
    await route.fulfill({ json: detail });
  });
  await page.goto(runPath);

  const rail = await getVisibleStageRail(page);
  await expect(rail.getByText("Waiting for the first meaningful progress update.")).toBeVisible();
  await expect(rail.getByText(/Last activity/)).toHaveCount(0);
  await expect(rail.getByText(/Updated .* ago/)).toHaveCount(0);
  await expect(
    rail.getByText(
      "This is taking longer than usual. Popcorn Ready is still waiting for an update.",
    ),
  ).toBeVisible();
  await expect(rail.getByText("OpenAI", { exact: true })).toBeVisible();
});

test("reveals server-authorized operator diagnostics progressively @mobile", async ({ page }) => {
  const detail = runDetail({
    status: "running",
    stageType: "asset_generation",
    operatorDiagnostics: [
      {
        jobId: "job-operator-123456789",
        actionId: "action-operator-123456789",
        runId,
        status: "running",
        currentStep: "generate_keyframe",
        providerLabel: "OpenAI",
        provider: "openai",
        attempt: 2,
        startedAt: now,
        heartbeatAt: now,
        lastProgressAt: now,
        updatedAt: now,
        attentionState: "possibly_stalled",
      },
    ],
  });
  await page.route(`**${apiRunPath}`, async (route) => {
    await route.fulfill({ json: detail });
  });
  await page.goto(runPath);

  const rail = await getVisibleStageRail(page);
  const diagnostics = rail.getByText("Operator diagnostics", { exact: true });
  await expect(diagnostics).toBeVisible();
  await expect(rail.getByText("generate_keyframe", { exact: true })).not.toBeVisible();
  await diagnostics.click();
  await expect(rail.getByText("generate_keyframe", { exact: true })).toBeVisible();
  await expect(rail.getByText("openai", { exact: true })).toBeVisible();
  await expect(rail.getByText("2", { exact: true })).toBeVisible();
});

test("retains authorized operator diagnostics beside the Creative Director hierarchy @mobile", async ({
  page,
}) => {
  const detail = runDetail({
    status: "running",
    stageType: "asset_generation",
    hierarchy: hierarchyFixture(),
    operatorDiagnostics: [
      {
        jobId: "job-hierarchy-123456789",
        actionId: "action-hierarchy-123456789",
        runId,
        status: "running",
        currentStep: "generate_hierarchy_keyframe",
        provider: "openai",
        attempt: 3,
        startedAt: now,
        heartbeatAt: now,
        lastProgressAt: now,
        updatedAt: now,
        attentionState: "healthy",
      },
    ],
  });
  await page.route(`**${apiRunPath}`, async (route) => {
    await route.fulfill({ json: detail });
  });
  await page.goto(runPath);

  await expect(page.getByRole("heading", { name: "Creative Director" })).toBeVisible();
  const diagnostics = page.getByText("Operator diagnostics", { exact: true });
  await expect(diagnostics).toBeVisible();
  await expect(page.getByText("generate_hierarchy_keyframe", { exact: true })).not.toBeVisible();
  await diagnostics.click();
  await expect(page.getByText("generate_hierarchy_keyframe", { exact: true })).toBeVisible();
  await expect(page.getByText("openai", { exact: true })).toBeVisible();
  await expect(page.getByText("3", { exact: true })).toBeVisible();
});

test("opens generated asset feedback and previews an exact durable proposal @mobile", async ({ page }) => {
  let proposalRequestBody: unknown = null;
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
        prompt: "Warm cinematic score with a dramatic orchestral swell.",
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
  await page.route(`**/api/v1/projects/${projectId}/rerun-proposals/v2`, async (route) => {
    proposalRequestBody = await route.request().postDataJSON();
    const target = {
      kind: "asset",
      projectId,
      assetId: "asset-score-1",
    };
    await route.fulfill({
      status: 201,
      json: {
        actionId: "22222222-2222-4222-8222-222222222222",
        proposal: {
          schemaVersion: "RerunProposal.v2",
          projectId,
          rootRunId: runId,
          source: "request_changes",
          userIntent: "Make the score less dramatic.",
          targets: [target],
          inspectedAssetIds: ["asset-score-1"],
          candidateAffectedAssetIds: ["asset-score-1"],
          preservedAssetIds: [],
          checklist: [{ target, decision: "change", reason: "Revise this score." }],
          pins: { assets: [], selections: [], storySnapshots: [] },
          estimate: { costUsd: 0.1, maxCostUsd: 0.2, latencyClass: "interactive" },
          risk: "low",
          requiresApproval: true,
          rationale: "Only the selected score needs to change.",
          userFacingSummary: "Revise the selected score",
          outcome: "revision",
          selectedWork: [],
          plannedSelectionMoves: [],
          plannedStoryPointerMoves: [],
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

  const feedback = dialog.getByLabel("What should change?");
  await feedback.fill("Make the score less dramatic.");
  await expect.poll(() => getCount).toBeGreaterThan(1);
  await expect(dialog).toBeVisible();
  await expect(feedback).toHaveValue("Make the score less dramatic.");

  await dialog.getByRole("button", { name: "Preview changes" }).click();
  await expect(dialog.getByRole("heading", { name: "Revise the selected score" })).toBeVisible();
  expect(proposalRequestBody).toEqual({
    message: "Make the score less dramatic.",
    rootRunId: runId,
    targets: [{
      kind: "asset",
      projectId,
      assetId: "asset-score-1",
    }],
  });
});

test("submits review-gate approval and previews durable requested changes @mobile", async ({ page }) => {
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
  let proposalRequestBody: unknown = null;
  await page.route(`**/api/v1/projects/${projectId}/rerun-proposals/v2`, async (route) => {
    proposalRequestBody = await route.request().postDataJSON();
    const target = { kind: "project", projectId };
    await route.fulfill({
      status: 201,
      json: {
        actionId: "22222222-2222-4222-8222-222222222222",
        proposal: {
          schemaVersion: "RerunProposal.v2",
          projectId,
          rootRunId: runId,
          source: "request_changes",
          userIntent: "Make the ending less busy.",
          targets: [target],
          inspectedAssetIds: [],
          candidateAffectedAssetIds: [],
          preservedAssetIds: [],
          checklist: [{ target, decision: "change", reason: "Revise this review boundary." }],
          pins: { assets: [], selections: [], storySnapshots: [] },
          estimate: { costUsd: 0.1, maxCostUsd: 0.2, latencyClass: "interactive" },
          risk: "low",
          requiresApproval: true,
          rationale: "The requested change will run through the durable lifecycle.",
          userFacingSummary: "Revise the concept review",
          outcome: "revision",
          selectedWork: [],
          plannedSelectionMoves: [],
          plannedStoryPointerMoves: [],
        },
      },
    });
  });

  await page.goto(runPath);

  await expect(page.getByText("Needs review")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve and continue" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Request changes" })).toBeVisible();

  await fillReviewFeedback(page, "Keep the close-up, simplify the transition.");
  await Promise.all([
    page.waitForResponse((response) => {
      const request = response.request();
      return (
        request.method() === "POST" &&
        new URL(response.url()).pathname === `${apiRunPath}/approve` &&
        response.ok()
      );
    }),
    page.getByRole("button", { name: "Approve and continue" }).click(),
  ]);

  await expect(page.getByText("Visuals are in progress.")).toBeVisible();
  await expect(page.getByText("Needs review")).toHaveCount(0);
  await expect(page.getByLabel("Feedback")).toHaveCount(0);
  expect(requests).toContainEqual({
    action: "approve",
    body: { note: "Keep the close-up, simplify the transition." },
  });

  detail = runDetail({
    status: "running",
    stageType: "brief_intake",
    progressPercent: 10,
    reviewGate: {
      stageId: "stage-brief_intake",
      stageType: "brief_intake",
      state: "awaiting_review",
      enteredAt: now,
    },
    message: "Concept is ready for review.",
  });
  await page.reload();
  await expect(page.getByText("Needs review")).toBeVisible();
  await fillReviewFeedback(page, "Make the ending less busy.");
  await page.getByRole("button", { name: "Request changes" }).click();
  await page.getByRole("button", { name: "Preview changes" }).click();

  await expect(page.getByRole("heading", { name: "Revise the concept review" })).toBeVisible();
  expect(proposalRequestBody).toEqual({
    message: "Make the ending less busy.",
    rootRunId: runId,
    targets: [{ kind: "project", projectId }],
  });
  expect(requests.some((request) => request.action === "reject")).toBe(false);
});

test("shows a stored recovery hint while loading and then renders failure details @mobile", async ({
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
      completionKind: options.completionKind,
      presentationKind: options.presentationKind,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      completedAt:
        options.status === "failed" || options.status === "canceled" || options.status === "succeeded"
          ? now
          : undefined,
      error: options.error,
    },
    stages: options.presentationKind
      ? [{
          stageId,
          runId,
          type: stageType,
          toolName: options.presentationKind === "standalone_image"
            ? "generate_image_asset"
            : options.presentationKind === "standalone_video"
              ? "generate_video_asset"
              : "generate_audio",
          label: options.presentationKind === "standalone_image"
            ? "Image asset"
            : options.presentationKind === "standalone_video"
              ? "Video asset"
              : "Audio asset",
          order: 9,
          status: options.status ?? "running",
          progressPercent: options.status === "succeeded" ? 100 : 25,
          message: options.message,
          startedAt: now,
          completedAt: options.status === "succeeded" ? now : undefined,
          jobIds: [],
          artifactIds: ["asset-1"],
          createdAt: now,
          updatedAt: now,
        }]
      : buildStages(stageType, {
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
    operatorDiagnostics: options.operatorDiagnostics,
    hierarchy: options.hierarchy,
  };
}

function hierarchyFixture() {
  return {
    root: {
      runId,
      state: "active",
      message: "The creative director is guiding this production.",
      needsDirectorDecision: false,
    },
    sessions: [
      {
        sessionId: "session-visuals",
        domain: "visuals",
        state: "active",
        runs: [
          {
            runId: "run-visuals-1",
            state: "active",
            taskKind: "visual_production",
            report: null,
            actions: [
              {
                actionId: "action-visuals-1",
                label: "Generate shots",
                state: "active",
                outputAssetIds: ["asset-shot-1", "asset-shot-2", "asset-shot-3"],
                jobs: [{ state: "active", completedItems: 3, totalItems: 6 }],
              },
            ],
          },
        ],
      },
      {
        sessionId: "session-audio",
        domain: "audio",
        state: "complete",
        runs: [
          {
            runId: "run-audio-1",
            state: "complete",
            taskKind: "audio_production",
            report: { outcome: "done", outputAssetIds: ["asset-audio-1"] },
            actions: [
              {
                actionId: "action-audio-1",
                label: "Generate audio",
                state: "complete",
                outputAssetIds: ["asset-audio-1"],
                jobs: [{ state: "complete", completedItems: 1, totalItems: 1 }],
              },
            ],
          },
        ],
      },
    ],
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
