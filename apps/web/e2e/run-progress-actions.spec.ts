import { expect, test } from "@playwright/test";
import {
  e2eProjectId,
  installRunProgressRoutes,
  makeRunDetail,
  reviewGate,
} from "./fixtures/run-progress";

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
    await expect(page.getByRole("heading", { name: "Active generation" })).toBeVisible();

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

    await page.getByRole("button", { name: "Cancel generation" }).click();

    await expect.poll(() => routes.actionBodies).toEqual([{ action: "cancel", body: {} }]);
    await expect(page.getByText("Generation was canceled.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel generation" })).toHaveCount(0);
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

    await page.getByRole("button", { name: "Cancel generation" }).click();

    await expect.poll(() => routes.actionBodies[0]).toEqual({
      action: "cancel",
      body: {},
    });
    await expect(page.getByText("Generation was canceled.")).toBeVisible();
  });

  test("approve and reject review gates post feedback and clear the note", async ({ page }) => {
    const gated = makeRunDetail("run-gated", {
      status: "running",
      reviewGate: reviewGate("quality_review"),
      message: "Quality review is waiting for approval.",
    });
    const routes = await installRunProgressRoutes(page, { detail: gated });

    await page.goto(`/projects/${e2eProjectId}/runs/${gated.run.runId}`);
    await expect(page.getByRole("heading", { name: "Quality review ready for review" })).toBeVisible();

    const feedback = page.getByLabel("Feedback");
    await feedback.fill("Tighten the pacing before final export.");
    await page.getByRole("button", { name: "Approve and continue" }).click();

    await expect.poll(() => routes.actionBodies[0]).toEqual({
      action: "approve",
      body: { note: "Tighten the pacing before final export." },
    });
    await expect(page.getByText("Review approved. Final render is in progress.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Quality review ready for review" })).toHaveCount(0);

    const gatedAgain = makeRunDetail("run-reject", {
      status: "running",
      reviewGate: reviewGate("quality_review"),
      message: "Quality review is waiting for approval.",
    });
    const rejectRoutes = await installRunProgressRoutes(page, { detail: gatedAgain });

    await page.goto(`/projects/${e2eProjectId}/runs/${gatedAgain.run.runId}`);
    await page.getByLabel("Feedback").fill("Regenerate with a stronger ending.");
    await page.getByRole("button", { name: "Request changes" }).click();

    await expect.poll(() => rejectRoutes.actionBodies[0]).toEqual({
      action: "reject",
      body: {
        stageType: "quality_review",
        note: "Regenerate with a stronger ending.",
      },
    });
    await expect(page.getByText("Feedback received. Regenerating this stage.")).toBeVisible();
    await expect(page.getByLabel("Feedback")).toHaveCount(0);
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
    await expect(page.getByText("Generation failed")).toBeVisible();
    await expect(page.getByText("Continuity check failed.")).toBeVisible();

    const succeeded = makeRunDetail("run-succeeded", {
      status: "succeeded",
      currentStageType: "ready",
      message: "Your video is ready.",
      completedAt: "2026-06-16T14:10:00.000Z",
    });
    await installRunProgressRoutes(page, { detail: succeeded });

    await page.goto(`/projects/${e2eProjectId}/runs/${succeeded.run.runId}?studioDraft=draft-e2e`);
    await expect(page).toHaveURL(/\/studio\?draft=draft-e2e&step=review$/);
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
});
