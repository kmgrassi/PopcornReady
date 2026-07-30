import { expect, test, type Page } from "@playwright/test";
import {
  e2eProjectId,
  installRunProgressRoutes,
  installRerunProposalRoute,
  makeRunDetail,
  reviewGate,
} from "./fixtures/run-progress";

async function clickStopHere(page: Page) {
  const stopHere = page.getByRole("button", { name: "Stop here" });
  if (await stopHere.isVisible().catch(() => false)) {
    await stopHere.click();
    return;
  }

  await page.locator("summary").filter({ hasText: "More" }).click();
  await stopHere.click();
}

async function fillReviewFeedback(page: Page, note: string) {
  const legacyFeedback = page.locator("textarea#review-feedback-note").filter({ visible: true });
  if ((await legacyFeedback.count()) === 1) {
    await legacyFeedback.fill(note);
    return;
  }

  await page.getByRole("button", { name: "Request changes" }).click();
  await page.getByLabel("What should change?").fill(note);
}

test.describe("run progress actions", () => {
  test("canceling an active ungated run posts the action, clears recovery, and renders terminal UI", async ({
    page,
  }) => {
    const active = makeRunDetail("run-cancel", {
      status: "running",
      currentStageType: "quality_review",
      message: "Quality review is running.",
    });
    const routes = await installRunProgressRoutes(page, { detail: active });

    await page.goto(`/projects/${e2eProjectId}/runs/${active.run.runId}`);
    await expect(page.getByRole("heading", { name: "Stop here or keep producing" })).toHaveCount(0);
    const rail = page.getByRole("complementary", { name: "Stage rail" });
    await expect(rail.getByText("Final Render")).toBeVisible();
    await expect(rail.getByText("In progress")).toBeVisible();

    await expect(
      page.evaluate((projectId) => {
        window.sessionStorage.setItem(
          `popcornReady:lastRunHint:${projectId}`,
          JSON.stringify({
            runId: "run-cancel",
            status: "running",
            updatedAt: "2026-06-16T14:00:00.000Z",
          }),
        );
      }, e2eProjectId),
    ).resolves.toBeUndefined();

    await rail.getByRole("button", { name: "Stop here" }).click();

    await expect.poll(() => routes.actionBodies).toEqual([{ action: "cancel", body: {} }]);
    await expect(page.getByRole("status").getByText("Generation was canceled.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop here" })).toHaveCount(0);
    await expect(
      page.evaluate((projectId) =>
        window.sessionStorage.getItem(`popcornReady:lastRunHint:${projectId}`),
      e2eProjectId),
    ).resolves.toBeNull();
  });

  test("canceling a run paused at review posts the action", async ({ page }) => {
    const gated = makeRunDetail("run-gated-cancel", {
      status: "running",
      reviewGate: reviewGate("brief_intake"),
      currentStageType: "brief_intake",
      message: "Concept is waiting for approval.",
    });
    const routes = await installRunProgressRoutes(page, { detail: gated });

    await page.goto(`/projects/${e2eProjectId}/runs/${gated.run.runId}`);
    await expect(page.getByRole("heading", { name: "Concept ready for review" })).toBeVisible();

    await clickStopHere(page);

    await expect.poll(() => routes.actionBodies[0]).toEqual({
      action: "cancel",
      body: {},
    });
    await expect(page.getByRole("status").getByText("Generation was canceled.")).toBeVisible();
  });

  test("approves review gates and opens durable change proposals", async ({ page }) => {
    const gated = makeRunDetail("run-gated", {
      status: "running",
      reviewGate: reviewGate("quality_review"),
      message: "Quality review is waiting for approval.",
    });
    const routes = await installRunProgressRoutes(page, { detail: gated });

    await page.goto(`/projects/${e2eProjectId}/runs/${gated.run.runId}`);
    await expect(page.getByRole("heading", { name: "Quality review ready for review" })).toBeVisible();

    await fillReviewFeedback(page, "Tighten the pacing before final export.");
    await page.getByRole("button", { name: "Approve and continue" }).click();

    await expect.poll(() => routes.actionBodies[0]).toEqual({
      action: "approve",
      body: { note: "Tighten the pacing before final export." },
    });
    await expect(page.getByText("Review approved. Final render is in progress.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Quality review ready for review" })).toHaveCount(0);

    const gatedAgain = makeRunDetail("run-reject", {
      status: "running",
      reviewGate: reviewGate("brief_intake"),
      currentStageType: "brief_intake",
      message: "Concept is waiting for approval.",
    });
    const rejectRoutes = await installRunProgressRoutes(page, { detail: gatedAgain });
    const proposalRequests = await installRerunProposalRoute(page, {
      expectedTarget: { kind: "project", projectId: e2eProjectId },
      summary: "Revise the concept",
    });

    await page.goto(`/projects/${e2eProjectId}/runs/${gatedAgain.run.runId}`);
    await fillReviewFeedback(page, "Regenerate with a stronger ending.");
    await page.getByRole("button", { name: "Request changes" }).click();
    await page.getByRole("button", { name: "Preview changes" }).click();

    await expect(page.getByRole("heading", { name: "Revise the concept" })).toBeVisible();
    await expect.poll(() => proposalRequests[0]).toEqual({
      message: "Regenerate with a stronger ending.",
      rootRunId: gatedAgain.run.runId,
      targets: [{ kind: "project", projectId: e2eProjectId }],
    });
    expect(rejectRoutes.actionBodies).toEqual([]);
  });

  test("failed runs and successful studio-linked runs render the right recovery paths", async ({
    page,
  }) => {
    const failed = makeRunDetail("run-failed", {
      status: "failed",
      message: "Generation failed during quality review.",
      error: {
        code: "quality_review_failed",
        message: "Continuity check failed.",
        retryable: true,
      },
      completedAt: "2026-06-16T14:05:00.000Z",
    });
    await installRunProgressRoutes(page, { detail: failed });

    await page.goto(`/projects/${e2eProjectId}/runs/${failed.run.runId}`);
    await expect(page.getByText("Generation failed", { exact: true })).toBeVisible();
    await expect(page.getByText("Continuity check failed.")).toBeVisible();

    const succeeded = makeRunDetail("run-succeeded", {
      status: "succeeded",
      currentStageType: "ready",
      message: "Your video is ready.",
      completedAt: "2026-06-16T14:10:00.000Z",
    });
    await installRunProgressRoutes(page, { detail: succeeded });

    // The retired Studio route is gone, so a studio-linked succeeded run no
    // longer redirects to /studio — it stays on the run progress page.
    await page.goto(`/projects/${e2eProjectId}/runs/${succeeded.run.runId}?studioDraft=draft-e2e`);
    await expect(page).toHaveURL(
      new RegExp(`/projects/${e2eProjectId}/runs/${succeeded.run.runId}`),
    );
  });

  test("loading state shows the last-run recovery hint while polling waits", async ({ page }) => {
    const active = makeRunDetail("run-recovery", {
      status: "running",
      currentStageType: "quality_review",
    });
    let releaseRunRequest: () => void = () => {};
    const runRequestBarrier = new Promise<void>((resolve) => {
      releaseRunRequest = resolve;
    });
    await installRunProgressRoutes(page, {
      detail: active,
      waitForGet: runRequestBarrier,
    });
    await page.addInitScript((projectId) => {
      window.sessionStorage.setItem(
        `popcornReady:lastRunHint:${projectId}`,
        JSON.stringify({
          runId: "run-recovery",
          status: "running",
          updatedAt: "2026-06-16T14:00:00.000Z",
        }),
      );
    }, e2eProjectId);

    await page.goto(`/projects/${e2eProjectId}/runs/${active.run.runId}`);

    await expect(page.getByText("Last seen run")).toContainText("run-recovery");
    releaseRunRequest();
    await expect(page.getByText("Quality review is running.")).toBeVisible();
  });

  test("unknown progress is indeterminate and recovery keeps failed work visible", async ({ page }) => {
    const active = makeRunDetail("run-indeterminate", {
      status: "running",
      currentStageType: "storyboard",
      currentToolName: "generate_storyboard",
      activityState: "recovering",
      progressPercent: null,
      message: "Generating storyboard frames after a clip prerequisite failed.",
    });
    active.stages.push({
      ...active.stages[0],
      stageId: "failed-clip",
      type: "asset_generation",
      toolName: "generate_clip",
      label: "Generate clips",
      order: 50,
      status: "failed",
      progressPercent: undefined,
      error: { code: "precondition_unmet", message: "No keyframe was selected.", retryable: true },
    });
    await installRunProgressRoutes(page, { detail: active });

    await page.goto(`/projects/${e2eProjectId}/runs/${active.run.runId}`);

    const overall = page.getByRole("progressbar", {
      name: "Generation in progress; percentage unavailable",
    });
    await expect(overall).toBeVisible();
    await expect(overall).not.toHaveAttribute("aria-valuenow");
    await expect(page.getByText(/50%|0%/)).toHaveCount(0);
    await expect(page.getByText("Recovering", { exact: true }).first()).toBeVisible();
    const visibleRail = page
      .getByRole("complementary", { name: "Stage rail" })
      .filter({ visible: true });
    await expect(visibleRail.getByText("Generate clips")).toBeVisible();
    await expect(visibleRail.getByText("Failed", { exact: true })).toHaveCount(2);
  });

  test("production-shaped storyboard-only terminal result never claims video completion", async ({ page }) => {
    const partial = makeRunDetail("run-storyboard-only", {
      status: "failed",
      currentStageType: "storyboard",
      progressPercent: null,
      message: "Storyboard ready; no video was created.",
      error: {
        code: "missing_video_output",
        message: "Storyboard ready; no video was created.",
        retryable: true,
      },
      completedAt: "2026-06-16T14:10:00.000Z",
    });
    await installRunProgressRoutes(page, { detail: partial });

    await page.goto(`/projects/${e2eProjectId}/runs/${partial.run.runId}`);

    await expect(page.getByText("Run ended without a playable video")).toBeVisible();
    await expect(page.getByText(/Your video is (complete|ready)/i)).toHaveCount(0);
    await expect(
      page.getByRole("progressbar", {
        name: "Generation in progress; percentage unavailable",
      }),
    ).toHaveCount(0);
  });

  test("succeeded legacy payload without completion evidence does not claim video ready", async ({ page }) => {
    const ended = makeRunDetail("run-ended-unknown", {
      status: "succeeded",
      completionKind: null,
      currentStageType: "ready",
      progressPercent: null,
      message: "Run ended.",
      completedAt: "2026-06-16T14:10:00.000Z",
    });
    await installRunProgressRoutes(page, { detail: ended });

    await page.goto(`/projects/${e2eProjectId}/runs/${ended.run.runId}`);

    await expect(page.getByText("Run ended without a playable video")).toBeVisible();
    await expect(page.getByText(/Your video is (complete|ready)/i)).toHaveCount(0);
    await expect(page.getByText(/Storyboard ready/i)).toHaveCount(0);
  });
});
