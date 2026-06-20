import { expect, test, type Page } from "@playwright/test";

const createdAt = "2026-06-16T12:00:00.000Z";

const suitesResponse = {
  suites: [
    {
      id: "suite_story_quality",
      name: "Story quality regression",
      description: "Checks the core story arc and timeline quality gates.",
      latestPassRate: 0.75,
      latestRunId: "evalrun_latest",
      trend: [0.5, 0.75, 0.75],
      stageRates: [
        { stageType: "creative_plan", passRate: 1, verdict: "pass" },
        { stageType: "timeline_assembly", passRate: 0.5, verdict: "needs_review" },
      ],
    },
  ],
};

const runResponse = {
  run: {
    id: "evalrun_latest",
    source: "suite",
    suiteId: "suite_story_quality",
    generationMode: "prompts_only",
    gitSha: "abc1234",
    branch: "codex/eval-dashboard-e2e",
    judgeModels: { "story_arc.v1": "fixture-judge" },
    status: "succeeded",
    createdAt,
    completedAt: createdAt,
  },
  evalRun: {
    id: "evalrun_latest",
    source: "suite",
    suiteId: "suite_story_quality",
    generationMode: "prompts_only",
    gitSha: "abc1234",
    branch: "codex/eval-dashboard-e2e",
    judgeModels: { "story_arc.v1": "fixture-judge" },
    status: "succeeded",
    createdAt,
    completedAt: createdAt,
  },
  suiteName: "Story quality regression",
  passRate: 0.75,
  previousRunId: "evalrun_previous",
  cases: [
    {
      id: "case_launch",
      suiteId: "suite_story_quality",
      label: "Launch announcement",
      stimulus: {
        kind: "brief",
        goal: "Launch a product",
        targetLengthSec: 30,
        style: "documentary",
        aspectRatio: "16:9",
      },
      stagesToRun: ["creative_plan", "timeline_assembly"],
      artifacts: [],
    },
    {
      id: "case_bakery",
      suiteId: "suite_story_quality",
      label: "Bakery rebuild",
      stimulus: {
        kind: "brief",
        goal: "Tell a recovery story",
        targetLengthSec: 45,
        style: "warm documentary",
        aspectRatio: "16:9",
      },
      stagesToRun: ["creative_plan", "timeline_assembly"],
      artifacts: [],
    },
  ],
  stages: ["creative_plan", "timeline_assembly"],
  judgments: [
    {
      id: "judgment_launch_plan",
      evaluatorId: "story_arc.v1",
      rubricVersion: "v1",
      judgeModel: "fixture-judge",
      evalRunId: "evalrun_latest",
      caseId: "case_launch",
      stageId: "case_launch:creative_plan",
      artifactId: "artifact_launch_plan",
      grades: { storyArc: 9 },
      verdict: "pass",
      rationale: "Clear turn and payoff.",
      evidenceRef: "artifact_launch_plan",
      trigger: "auto",
      costUsd: 0,
      latencyMs: 12,
      createdAt,
      stageType: "creative_plan",
    },
    {
      id: "judgment_bakery_timeline",
      evaluatorId: "timeline_assembly.v1",
      rubricVersion: "v1",
      judgeModel: "fixture-judge",
      evalRunId: "evalrun_latest",
      caseId: "case_bakery",
      stageId: "case_bakery:timeline_assembly",
      artifactId: "artifact_bakery_timeline",
      grades: { continuity: 7 },
      verdict: "needs_review",
      rationale: "Timeline beat spacing needs a second look.",
      evidenceRef: "artifact_bakery_timeline",
      trigger: "auto",
      costUsd: 0,
      latencyMs: 18,
      createdAt,
      stageType: "timeline_assembly",
    },
  ],
  expectationResults: [],
  calibration: {
    matchRate: 0.88,
    labeledCases: 8,
  },
};

const diffResponse = {
  baseRunId: "evalrun_latest",
  againstRunId: "evalrun_previous",
  flips: [
    {
      caseId: "case_bakery",
      caseLabel: "Bakery rebuild",
      stageId: "case_bakery:timeline_assembly",
      stageType: "timeline_assembly",
      evaluatorId: "timeline_assembly.v1",
      before: "pass",
      after: "needs_review",
    },
  ],
};

const manualJudgmentResponse = {
  judgment: {
    id: "judgment_manual_clip",
    evaluatorId: "video_prompt.v1",
    rubricVersion: "v1",
    judgeModel: "fixture-judge",
    stageId: "manual:video_prompt",
    artifactId: "artifact_clip_003",
    grades: { specificity: 8 },
    verdict: "pass",
    rationale: "The clip prompt is concrete, bounded, and media-ready.",
    trigger: "manual",
    costUsd: 0,
    latencyMs: 15,
    createdAt,
  },
};

async function mockEvalApi(page: Page) {
  await page.route("**/api/v1/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        actor: { id: "dev-user", type: "local", email: "local@example.test" },
        workspaceId: "dev_workspace",
        workspaceName: "Dev workspace",
        authMode: "local",
        isLocal: true,
      }),
    });
  });

  await page.route("**/api/v1/eval/suites", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(suitesResponse),
    });
  });

  await page.route("**/api/v1/eval/runs/evalrun_latest", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(runResponse),
    });
  });

  await page.route("**/api/v1/eval/runs/evalrun_latest/diff?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(diffResponse),
    });
  });
}

test("legacy eval library route redirects to the admin workbench", async ({ page }) => {
  await mockEvalApi(page);

  await page.goto("/library/evals");

  await expect(page).toHaveURL(/\/admin\/evals$/);
  await expect(page.getByRole("heading", { name: "Manual story judgment" })).toBeVisible();
});

test("admin eval workbench posts a manual judgment and updates the card", async ({ page }) => {
  await mockEvalApi(page);
  const judgmentRequest = page.waitForRequest((request) => {
    return request.method() === "POST" && request.url().endsWith("/api/v1/eval/judgments");
  });

  await page.route("**/api/v1/eval/judgments", async (route) => {
    const requestBody = route.request().postDataJSON() as {
      evaluatorId: string;
      artifactId: string;
    };
    expect(requestBody).toEqual({
      evaluatorId: "video_prompt.v1",
      artifactId: "artifact_clip_003",
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(manualJudgmentResponse),
    });
  });

  await page.goto("/admin/evals");

  const artifactCard = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "Ovens relight beat" }) });
  await expect(page.getByRole("heading", { name: "Manual story judgment" })).toBeVisible();
  await expect(artifactCard.getByText("No judgment yet.")).toBeVisible();

  await artifactCard.getByRole("button", { name: "Run judge" }).click();

  await judgmentRequest;
  await expect(artifactCard.getByText("The clip prompt is concrete")).toBeVisible();
  await expect(artifactCard.getByText("Pass")).toBeVisible();
});
