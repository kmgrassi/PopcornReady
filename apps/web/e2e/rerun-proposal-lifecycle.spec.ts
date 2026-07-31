import { expect, test, type Page, type Route } from "@playwright/test";
import { mockLocalApi, now, workspaceId } from "./fixtures/local-api";

const projectId = "11111111-1111-4111-8111-111111111111";
const proposalActionId = "22222222-2222-4222-8222-222222222222";
const approvalActionId = "33333333-3333-4333-8333-333333333333";
const reservationId = "44444444-4444-4444-8444-444444444444";
const refreshedActionId = "55555555-5555-4555-8555-555555555555";
const freshActionId = "66666666-6666-4666-8666-666666666666";

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function proposal() {
  const target = { kind: "project", projectId } as const;
  return {
    schemaVersion: "RerunProposal.v2",
    projectId,
    rootRunId: null,
    source: "request_changes",
    userIntent: "Make the concept warmer without changing the script.",
    targets: [target],
    inspectedAssetIds: ["asset-concept"],
    candidateAffectedAssetIds: ["asset-concept"],
    preservedAssetIds: ["asset-script", "asset-audio"],
    checklist: [
      {
        target,
        decision: "change",
        reason: "Update the project concept and its visual direction.",
      },
      {
        target,
        decision: "preserve",
        reason: "Keep the approved script and audio unchanged.",
      },
    ],
    pins: { assets: [], selections: [], storySnapshots: [] },
    estimate: {
      costUsd: 0.8,
      maxCostUsd: 1.2,
      latencyClass: "interactive",
    },
    risk: "medium",
    requiresApproval: true,
    rationale: "The concept can change without rebuilding approved downstream work.",
    userFacingSummary: "Warm the concept while preserving script and audio",
    outcome: "revision",
    selectedWork: [
      {
        workItemId: "work-story",
        owner: "creative_director",
        kind: "revise_story",
        targets: [target],
        requiredOutputs: [
          {
            bindingId: "binding-story",
            workItemId: "work-story",
            target,
            kind: "story_snapshot",
            role: "story",
            ordinal: 0,
          },
        ],
      },
    ],
    plannedSelectionMoves: [],
    plannedStoryPointerMoves: [],
  };
}

async function installProject(
  page: Page,
  projectName: () => string = () => "Warm launch"
) {
  await mockLocalApi(page);
  await page.route(`**/api/v1/projects/${projectId}`, (route) =>
    json(route, {
      project: {
        id: projectId,
        schemaVersion: "project.v1",
        workspaceId,
        name: projectName(),
        status: "active",
        visibility: "private",
        hasStoryboard: false,
        posterUrl: null,
        brief: {
          goal: "Launch a calm collaboration tool.",
          targetLengthSec: 30,
          aspectRatio: "16:9",
          platform: "web",
          format: "brand",
          audience: "creative teams",
          oneBigIdea: "Make teamwork feel lighter.",
          hookQuestion: "What if collaboration felt calm?",
          strongestVisual: "A warm studio with a focused team.",
        },
        createdAt: now,
        updatedAt: now,
      },
    })
  );
  await page.route(`**/api/v1/projects/${projectId}/storyboard`, (route) =>
    json(route, { storyboard: null })
  );
  await page.route(
    `**/api/v1/projects/${projectId}/storyboards/generate`,
    (route) => json(route, { job: null })
  );
}

test("previews, approves, executes, and recovers a waiting proposal after reload", async ({
  page,
}) => {
  let projectName = "Warm launch";
  await installProject(page, () => projectName);
  let approved = false;
  let executionStatus:
    | "waiting"
    | "completed"
    | null = null;
  const requests: Array<{ operation: string; body: Record<string, unknown> }> = [];
  const base = `/api/v1/projects/${projectId}/rerun-proposals/v2`;

  await page.route(`**${base}`, async (route) => {
    requests.push({
      operation: "create",
      body: route.request().postDataJSON() as Record<string, unknown>,
    });
    await json(route, { actionId: proposalActionId, proposal: proposal() }, 201);
  });
  await page.route(`**${base}/${proposalActionId}`, async (route) => {
    await json(route, {
      actionId: proposalActionId,
      status: executionStatus
        ? executionStatus === "completed"
          ? "applied"
          : "running"
        : approved
          ? "approved"
          : "proposed",
      proposal: proposal(),
      approval: approved
        ? { approvalActionId, approvedMaxCostUsd: 1.2 }
        : null,
      execution: executionStatus
        ? {
            reservationId,
            status: executionStatus,
            executionActionId:
              executionStatus === "completed" ? "execution-action" : null,
            updatedAt: now,
          }
        : null,
      failure: null,
    });
  });
  await page.route(`**${base}/${proposalActionId}/approve`, async (route) => {
    approved = true;
    requests.push({
      operation: "approve",
      body: route.request().postDataJSON() as Record<string, unknown>,
    });
    await json(route, {
      actionId: proposalActionId,
      status: "approved",
      approvalActionId,
      replayed: false,
    });
  });
  await page.route(`**${base}/${proposalActionId}/execute`, async (route) => {
    executionStatus = "waiting";
    requests.push({
      operation: "execute",
      body: route.request().postDataJSON() as Record<string, unknown>,
    });
    await json(
      route,
      {
        actionId: proposalActionId,
        reservationId,
        status: "waiting",
        replayed: false,
      },
      202
    );
  });

  await page.goto(`/projects/${projectId}`);
  const trigger = page.getByRole("button", { name: "Request changes" }).first();
  await trigger.click();
  const textarea = page.getByLabel("What should change?");
  await expect(textarea).toBeFocused();
  await textarea.fill("Make the concept warmer without changing the script.");
  await page.getByRole("button", { name: "Preview changes" }).click();

  await expect(
    page.getByRole("heading", {
      name: "Warm the concept while preserving script and audio",
    })
  ).toBeVisible();
  await expect(page.getByText("Entire project context")).toBeVisible();
  await expect(page.getByText("2 existing assets will remain unchanged.")).toBeVisible();
  expect(requests[0]).toEqual({
    operation: "create",
    body: {
      message: "Make the concept warmer without changing the script.",
      targets: [{ kind: "project", projectId }],
    },
  });

  await page.getByRole("button", { name: "Approve up to $1.20" }).click();
  await expect(page.getByRole("button", { name: "Start changes" })).toBeVisible();
  expect(requests.find((request) => request.operation === "approve")?.body).toEqual({
    approvedMaxCostUsd: 1.2,
  });

  await page.getByRole("button", { name: "Start changes" }).click();
  await expect(page.getByRole("status").getByText("Changes in progress")).toBeVisible();
  const executeKey = requests.find(
    (request) => request.operation === "execute"
  )?.body.idempotencyKey;
  expect(executeKey).toMatch(/^[0-9a-f-]{36}$/);

  await page.reload();
  const restoredTrigger = page
    .getByRole("button", { name: "Request changes" })
    .first();
  await restoredTrigger.click();
  await expect(page.getByRole("status").getByText("Changes in progress")).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview changes" })).toHaveCount(0);

  executionStatus = "completed";
  projectName = "Warm launch revised";
  await expect(page.getByRole("status").getByText("Changes applied")).toBeVisible({
    timeout: 5_000,
  });
  await expect(
    page.getByRole("heading", { name: "Warm launch revised" })
  ).toBeVisible();
  await page.locator("footer").getByRole("button", { name: "Close" }).click();
  await expect(restoredTrigger).toBeFocused();

  await restoredTrigger.click();
  await expect(page.getByRole("button", { name: "Preview changes" })).toBeVisible();
});

test("restored creator cancellation remains canceled without a failure alert", async ({
  page,
}) => {
  await installProject(page);
  const base = `/api/v1/projects/${projectId}/rerun-proposals/v2`;
  let executionStatus: "waiting" | "canceled" = "waiting";

  await page.addInitScript(
    ({ key, actionId }) => window.localStorage.setItem(key, actionId),
    {
      key: `popcorn:rerun-proposal:${projectId}:project:${projectId}`,
      actionId: proposalActionId,
    }
  );
  await page.route(`**${base}/${proposalActionId}`, (route) =>
    json(route, {
      actionId: proposalActionId,
      status: executionStatus === "canceled" ? "failed" : "running",
      proposal: proposal(),
      approval: { approvalActionId, approvedMaxCostUsd: 1.2 },
      execution: {
        reservationId,
        status: executionStatus,
        executionActionId:
          executionStatus === "canceled" ? "execution-action-canceled" : null,
        updatedAt: now,
      },
      failure: null,
    })
  );
  await page.route(`**${base}/${proposalActionId}/cancel`, async (route) => {
    executionStatus = "canceled";
    await json(route, {
      actionId: proposalActionId,
      executionActionId: "execution-action-canceled",
      status: "canceled",
      canceled: true,
    });
  });

  await page.goto(`/projects/${projectId}`);
  await page.getByRole("button", { name: "Request changes" }).first().click();
  await expect(page.getByRole("status").getByText("Changes in progress")).toBeVisible();
  await page.getByRole("button", { name: "Cancel changes" }).click();
  await expect(page.getByRole("status").getByText("Changes canceled")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("clarifies intent and refreshes a stale preview before approval", async ({ page }) => {
  await installProject(page);
  const base = `/api/v1/projects/${projectId}/rerun-proposals/v2`;
  const clarification = {
    ...proposal(),
    outcome: "ask_clarification" as const,
    userFacingSummary: "Choose which warmth to change",
    selectedWork: [],
    clarification: {
      question: "Which kind of warmth do you mean?",
      answerFingerprint: "warmth-question-v1",
      options: [
        {
          id: "palette",
          label: "Color palette",
          tradeoff: "Keeps the story and pacing unchanged.",
        },
        {
          id: "tone",
          label: "Story tone",
          tradeoff: "May affect more downstream work.",
        },
      ],
    },
  };
  const clarified = {
    ...proposal(),
    userFacingSummary: "Warm the color palette only",
  };
  const fresh = {
    ...proposal(),
    userFacingSummary: "Warm the current color palette",
  };
  const refreshBodies: Array<Record<string, unknown>> = [];

  await page.route(`**${base}`, (route) =>
    json(route, { actionId: proposalActionId, proposal: clarification }, 201)
  );
  await page.route(`**${base}/${proposalActionId}`, (route) =>
    json(route, {
      actionId: proposalActionId,
      status: "proposed",
      proposal: clarification,
      approval: null,
      execution: null,
      failure: null,
    })
  );
  await page.route(`**${base}/${proposalActionId}/refresh`, async (route) => {
    refreshBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await json(route, {
      actionId: refreshedActionId,
      proposal: clarified,
      replayed: false,
    });
  });
  await page.route(`**${base}/${refreshedActionId}`, (route) =>
    json(route, {
      actionId: refreshedActionId,
      status: "proposed",
      proposal: clarified,
      approval: null,
      execution: null,
      failure: null,
    })
  );
  await page.route(`**${base}/${refreshedActionId}/approve`, (route) =>
    json(
      route,
      {
        error: {
          code: "stale_proposal",
          message: "The selected inputs changed after this preview.",
        },
      },
      409
    )
  );
  await page.route(`**${base}/${refreshedActionId}/refresh`, async (route) => {
    refreshBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await json(route, {
      actionId: freshActionId,
      proposal: fresh,
      replayed: false,
    });
  });
  await page.route(`**${base}/${freshActionId}`, (route) =>
    json(route, {
      actionId: freshActionId,
      status: "proposed",
      proposal: fresh,
      approval: null,
      execution: null,
      failure: null,
    })
  );

  await page.goto(`/projects/${projectId}`);
  await page.getByRole("button", { name: "Request changes" }).first().click();
  await page.getByLabel("What should change?").fill("Make this feel warmer.");
  await page.getByRole("button", { name: "Preview changes" }).click();

  await expect(
    page.getByRole("heading", { name: "Choose which warmth to change" })
  ).toBeVisible();
  await page.getByLabel("Color palette").check();
  await page.getByRole("button", { name: "Update preview" }).click();
  await expect(
    page.getByRole("heading", { name: "Warm the color palette only" })
  ).toBeVisible();
  expect(refreshBodies[0]).toMatchObject({
    message: "Make this feel warmer.",
    clarificationAnswer: {
      answerFingerprint: "warmth-question-v1",
      optionId: "palette",
    },
  });

  await page.getByRole("button", { name: "Approve up to $1.20" }).click();
  await expect(page.getByText("This preview is out of date.")).toBeVisible();
  await page.getByRole("button", { name: "Refresh preview" }).click();
  await expect(
    page.getByRole("heading", { name: "Warm the current color palette" })
  ).toBeVisible();
  await expect(page.getByText("This preview is out of date.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve up to $1.20" })).toBeVisible();
  expect(refreshBodies[1]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
});

test("proposal review remains usable without horizontal overflow @mobile", async ({
  page,
}) => {
  test.skip(!page.viewportSize() || page.viewportSize()!.width > 760);
  await installProject(page);

  await page.goto(`/projects/${projectId}/concept`);
  await page
    .getByRole("region", { name: "Concept editable objects" })
    .getByRole("button")
    .first()
    .click();
  await expect(page.getByLabel("What should change?")).toBeFocused();
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
});
