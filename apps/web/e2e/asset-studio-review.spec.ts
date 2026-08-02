import { expect, test, type Page } from "@playwright/test";
import {
  mockAssetStudioProject,
  fulfillJson,
  expectCreationTypeTargets,
  openProjectPicker,
  project,
  recentProject,
  longRunSummary,
} from "./fixtures/asset-studio";

import { mockLocalApi } from "./fixtures/local-api";

test.describe("Asset Studio", () => {
  test.beforeEach(async ({ page }) => {
    await mockLocalApi(page);
    await mockAssetStudioProject(page);
  });




  test("refines video prompts with motion direction and preserves the video draft @mobile", async ({
    page,
  }) => {
    const originalPrompt = "A cyclist crosses a rain-slick street";
    const effectivePrompt =
      "One continuous street-level shot of a cyclist entering frame left, crossing rain-slick pavement, and exiting frame right while the camera holds still.";
    let requestBody: Record<string, unknown> | null = null;
    let releaseProposal: (() => void) | undefined;
    const proposalReleased = new Promise<void>((resolve) => {
      releaseProposal = resolve;
    });

    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/proposals`,
      async (route) => {
        requestBody = route.request().postDataJSON();
        await proposalReleased;
        await fulfillJson(
          route,
          {
            proposal: {
              sessionId: "session_video",
              runId: "run_video",
              gateId: "gate_video",
              requestDigest: "digest_video",
              maximumUsd: 10,
              approvalToken: "approval_video",
              expiresAt: "2099-07-31T18:00:00.000Z",
              effectivePrompt,
              enhancementApplied: true,
            },
          },
          201,
        );
      },
    );

    await page.goto("/create/asset");
    const improveImage = page.getByRole("checkbox", {
      name: /Improve image prompt/,
    });
    await improveImage.uncheck();
    await page.getByText("Video", { exact: true }).click();
    const improve = page.getByRole("checkbox", {
      name: /Improve video prompt/,
    });
    await expect(improve).toBeChecked();
    await openProjectPicker(page);
    await page.getByRole("button", { name: project.name, exact: true }).click();
    await page
      .getByLabel("Describe the result", { exact: true })
      .fill(originalPrompt);
    await page.getByRole("button", { name: "Review request" }).click();

    await expect(page).toHaveURL(/\/create\/review$/);
    await expect(page.getByRole("heading", { name: "Improving your prompt" })).toBeVisible();
    await expect(page.getByText("clear motion direction before generation")).toBeVisible();
    releaseProposal?.();
    await expect(page.getByText(effectivePrompt)).toBeVisible();
    expect(requestBody).toMatchObject({
      kind: "video_create",
      prompt: originalPrompt,
      improvePrompt: true,
    });

    await page.getByRole("button", { name: "Revise request" }).click();
    await expect(page).toHaveURL(/\/create\/asset$/);
    await expect(
      page.getByRole("radio", {
        name: /^Video(?: A short motion asset for this project\.)?$/,
      }),
    ).toBeChecked();
    await expect(page.getByRole("checkbox", { name: /Improve video prompt/ })).toBeChecked();
    await expect(
      page.getByPlaceholder(
        "A cyclist crossing a rain-slick street as the camera holds still",
      ),
    ).toHaveValue(originalPrompt);
  });

  test("keeps prompt-improvement failure actionable and preserves revision", async ({
    page,
  }) => {
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/proposals`,
      (route) =>
        fulfillJson(
          route,
          {
            error: {
              code: "model_output_invalid",
              message:
                "We couldn't improve this image prompt. Retry, or turn off Improve image prompt to continue with your original request.",
            },
          },
          502,
        ),
    );

    await page.goto("/create/asset");
    await openProjectPicker(page);
    await page.getByRole("button", { name: project.name, exact: true }).click();
    const prompt = page.getByLabel("Describe the result", { exact: true });
    await prompt.fill("A precise campaign still");
    await page.getByRole("button", { name: "Review request" }).click();

    await expect(page).toHaveURL(/\/create\/review$/);
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "turn off Improve image prompt",
    );
    await page.getByRole("button", { name: "Revise request" }).click();
    await expect(page).toHaveURL(/\/create\/asset$/);
    await expect(
      page.getByPlaceholder(
        "A quiet amber-lit close-up of popcorn falling into a bowl",
      ),
    ).toHaveValue("A precise campaign still");
    await expect(
      page.getByRole("checkbox", { name: /Improve image prompt/ }),
    ).toBeChecked();
    await expect(page.getByRole("button", { name: "Review request" })).toBeEnabled();
    await expect(
      page.getByRole("button", { name: `Project ${project.name}`, exact: true }),
    ).toBeVisible();
  });

  test("browser Back cancels review and restores the editable draft", async ({ page }) => {
    let releaseProposal: (() => void) | undefined;
    const proposalReleased = new Promise<void>((resolve) => {
      releaseProposal = resolve;
    });
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/proposals`,
      async (route) => {
        await proposalReleased;
        await fulfillJson(route, {
          proposal: {
            sessionId: "session_back",
            runId: "run_back",
            gateId: "gate_back",
            requestDigest: "digest_back",
            maximumUsd: 10,
            approvalToken: "approval_back",
            expiresAt: "2099-07-31T18:00:00.000Z",
            effectivePrompt: "A restored editorial draft",
            enhancementApplied: true,
          },
        }, 201);
      },
    );

    await page.goto("/create/asset");
    await openProjectPicker(page);
    await page.getByRole("button", { name: project.name, exact: true }).click();
    await page.getByLabel("Describe the result", { exact: true }).fill("A restored draft");
    await page.getByRole("button", { name: "Review request" }).click();
    await expect(page.getByRole("heading", { name: "Improving your prompt" })).toBeVisible();

    await page.goBack();
    releaseProposal?.();
    await expect(page).toHaveURL(/\/create\/asset$/);
    await expect(
      page.getByPlaceholder(
        "A quiet amber-lit close-up of popcorn falling into a bowl",
      ),
    ).toHaveValue("A restored draft");
    await expect(
      page.getByRole("button", { name: `Project ${project.name}`, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Approve this" })).toHaveCount(0);
  });

  test("browser Forward restores the proposal without posting it again", async ({ page }) => {
    let proposalCount = 0;
    await page.clock.install();
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/proposals`,
      (route) => {
        proposalCount += 1;
        return fulfillJson(route, {
          proposal: {
            sessionId: "session_forward",
            runId: "run_forward",
            gateId: "gate_forward",
            requestDigest: "digest_forward",
            maximumUsd: 10,
            approvalToken: "approval_forward",
            expiresAt: "2099-07-31T18:00:00.000Z",
            effectivePrompt: "A restored proposal preview",
            enhancementApplied: true,
          },
        }, 201);
      },
    );

    await page.goto("/create/asset");
    await openProjectPicker(page);
    await page.getByRole("button", { name: project.name, exact: true }).click();
    await page.getByLabel("Describe the result", { exact: true }).fill("A proposal to restore");
    await page.getByRole("button", { name: "Review request" }).click();
    await expect(page.getByText("A restored proposal preview")).toBeVisible();
    await expect.poll(() => page.evaluate(() =>
      window.history.state?.usr?.assetCreationReview?.proposal?.gateId,
    )).toBe("gate_forward");

    await page.goBack();
    await expect(page).toHaveURL(/\/create\/asset$/);
    await page.goForward();

    await expect(page).toHaveURL(/\/create\/review$/);
    await expect(page.getByText("A restored proposal preview")).toBeVisible();
    await expect(page.getByText("Starting automatically in 10 seconds.")).toBeVisible();
    expect(proposalCount).toBe(1);
  });

  test("browser Forward fails safely when a restored proposal has expired", async ({ page }) => {
    let confirmationCount = 0;
    await page.clock.install();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/proposals`,
      (route) => fulfillJson(route, {
        proposal: {
          sessionId: "session_expired",
          runId: "run_expired",
          gateId: "gate_expired",
          requestDigest: "digest_expired",
          maximumUsd: 10,
          approvalToken: "approval_expired",
          expiresAt,
          effectivePrompt: "A proposal that will expire",
          enhancementApplied: true,
        },
      }, 201),
    );
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/proposals/gate_expired/confirm`,
      (route) => {
        confirmationCount += 1;
        return route.abort();
      },
    );

    await page.goto("/create/asset");
    await openProjectPicker(page);
    await page.getByRole("button", { name: project.name, exact: true }).click();
    await page.getByLabel("Describe the result", { exact: true }).fill("An expiring proposal");
    await page.getByRole("button", { name: "Review request" }).click();
    await expect(page.getByText("Starting automatically in 10 seconds.")).toBeVisible();
    await expect.poll(() => page.evaluate(() =>
      window.history.state?.usr?.assetCreationReview?.proposal?.gateId,
    )).toBe("gate_expired");

    await page.goBack();
    await page.clock.fastForward(61_000);
    await page.goForward();

    await expect(page.getByRole("heading", { name: "Prepare a new review" })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("needs to be refreshed");
    await expect(page.getByRole("button", { name: "Prepare again" })).toBeVisible();
    await expect(page.getByText(/Starting automatically in/)).toHaveCount(0);
    await page.clock.fastForward(10_000);
    expect(confirmationCount).toBe(0);
  });

  test("creates and immediately uses a new project without losing the prompt", async ({
    page,
  }) => {
    const createdProject = {
      ...project,
      id: "project_homepage_concepts",
      name: "Homepage concepts",
    };
    let createdName: string | null = null;
    let proposedProjectId: string | null = null;

    await page.route("**/api/v1/projects", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      createdName = route.request().postDataJSON().name;
      await fulfillJson(route, { project: createdProject }, 201);
    });
    await page.route(
      `**/api/v1/projects/${createdProject.id}/agent-creations/proposals`,
      async (route) => {
        proposedProjectId = createdProject.id;
        await fulfillJson(
          route,
          {
            proposal: {
              sessionId: "session_created",
              runId: "run_created",
              gateId: "gate_created",
              requestDigest: "digest_created",
              maximumUsd: 10,
              approvalToken: "approval_created",
              expiresAt: "2099-07-31T18:00:00.000Z",
              effectivePrompt: "A crisp editorial product still",
              enhancementApplied: true,
            },
          },
          201,
        );
      },
    );

    await page.goto("/create/asset");
    const prompt = page.getByLabel("Describe the result", { exact: true });
    await prompt.fill("A crisp editorial product still");
    const projectTrigger = await openProjectPicker(page);
    await page.getByRole("button", { name: "Create new project" }).click();
    await page.getByLabel("Project name").fill("  Homepage concepts  ");
    await page.getByRole("button", { name: "Create project" }).click();

    await expect(projectTrigger).toHaveAccessibleName(
      `Project ${createdProject.name}`,
    );
    expect(createdName).toBe("Homepage concepts");
    await expect(page.getByRole("searchbox", { name: "Find a project" })).toBeHidden();
    await expect(
      page.getByPlaceholder(
        "A quiet amber-lit close-up of popcorn falling into a bowl",
      ),
    ).toHaveValue("A crisp editorial product still");

    await page.getByRole("button", { name: "Review request" }).click();
    await expect(
      page.getByRole("heading", { name: "Approve this" }),
    ).toBeVisible();
    expect(proposedProjectId).toBe(createdProject.id);
  });

  test("does not let a delayed project creation override a newer selection", async ({
    page,
  }) => {
    const delayedProject = {
      ...project,
      id: "project_delayed",
      name: "Delayed project",
    };
    let releaseCreate: (() => void) | undefined;
    const createReleased = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    let markCreateStarted: (() => void) | undefined;
    const createStarted = new Promise<void>((resolve) => {
      markCreateStarted = resolve;
    });

    await page.route("**/api/v1/projects", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      markCreateStarted?.();
      await createReleased;
      await fulfillJson(route, { project: delayedProject }, 201);
    });

    await page.goto("/create/asset");
    await page
      .getByLabel("Describe the result", { exact: true })
      .fill("A delayed project race");
    const projectTrigger = await openProjectPicker(page);
    await page.getByRole("button", { name: "Create new project" }).click();
    await page.getByLabel("Project name").fill(delayedProject.name);
    await page.getByRole("button", { name: "Create project" }).click();
    await createStarted;
    await expect(
      page.getByRole("button", { name: "Review request" }),
    ).toBeDisabled();

    await page.keyboard.press("Escape");
    await expect(projectTrigger).toBeFocused();
    await projectTrigger.click();
    await page.getByRole("button", { name: project.name, exact: true }).click();
    await expect(projectTrigger).toHaveAccessibleName(`Project ${project.name}`);

    releaseCreate?.();
    await expect(page.getByRole("status")).toContainText("Project created");
    await expect(projectTrigger).toHaveAccessibleName(`Project ${project.name}`);
    await projectTrigger.click();
    await expect(
      page.getByRole("button", { name: delayedProject.name, exact: true }),
    ).toBeVisible();
    await expect(projectTrigger).toHaveAccessibleName(`Project ${project.name}`);
  });

  test("automatically approves once after the proposal has been visible for 10 seconds", async ({ page }) => {
    let confirmationCount = 0;
    await page.clock.install();
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/proposals`,
      (route) => fulfillJson(route, {
        proposal: {
          sessionId: "session_auto",
          runId: "run_auto",
          gateId: "gate_auto",
          requestDigest: "digest_auto",
          maximumUsd: 10,
          approvalToken: "approval_auto",
          expiresAt: "2099-07-31T18:00:00.000Z",
          effectivePrompt: "A considered editorial still",
          enhancementApplied: true,
        },
      }, 201),
    );
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/proposals/gate_auto/confirm`,
      (route) => {
        confirmationCount += 1;
        return fulfillJson(route, { sessionId: "session_auto", runId: "run_auto", enqueued: true }, 202);
      },
    );
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/run_auto`,
      (route) => fulfillJson(route, {
        sessionId: "session_auto",
        run: { id: "run_auto", status: "queued", inputSummary: "A considered editorial still" },
        report: null,
        outputs: [],
      }),
    );

    await page.goto("/create/asset");
    await openProjectPicker(page);
    await page.getByRole("button", { name: project.name, exact: true }).click();
    await page.getByLabel("Describe the result", { exact: true }).fill("A considered still");
    await page.getByRole("button", { name: "Review request" }).click();
    await expect(page.getByRole("heading", { name: "Approve this" })).toBeVisible();
    await expect(page.getByText("Starting automatically in 10 seconds.")).toBeVisible();

    await page.clock.fastForward(1_000);
    await expect(page.getByText("Starting automatically in 9 seconds.")).toBeVisible();
    await page.clock.fastForward(8_000);
    expect(confirmationCount).toBe(0);
    await page.clock.fastForward(1_000);
    await expect.poll(() => confirmationCount).toBe(1);
    await expect(page).toHaveURL(new RegExp(`/create/asset\\?projectId=${project.id}&runId=run_auto$`));
  });

  test("fails closed when the review route has no request state", async ({ page }) => {
    let proposalCount = 0;
    let confirmationCount = 0;
    await page.route("**/agent-creations/proposals", (route) => {
      proposalCount += 1;
      return route.abort();
    });
    await page.route("**/agent-creations/proposals/*/confirm", (route) => {
      confirmationCount += 1;
      return route.abort();
    });

    await page.goto("/create/review");
    await expect(page.getByRole("heading", { name: "This review is no longer available" })).toBeVisible();
    expect(proposalCount).toBe(0);
    expect(confirmationCount).toBe(0);
  });

  test("keeps an explicit request-only manual policy after the proposal returns", async ({ page }) => {
    let confirmationCount = 0;
    await page.clock.install();
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/proposals`,
      (route) => fulfillJson(route, {
        proposal: {
          sessionId: "session_manual_only",
          runId: "run_manual_only",
          gateId: "gate_manual_only",
          requestDigest: "digest_manual_only",
          maximumUsd: 10,
          approvalToken: "approval_manual_only",
          expiresAt: "2099-07-31T18:00:00.000Z",
          effectivePrompt: "A manual-only proposal",
          enhancementApplied: true,
        },
      }, 201),
    );
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/proposals/gate_manual_only/confirm`,
      (route) => {
        confirmationCount += 1;
        return route.abort();
      },
    );

    await page.goto("/create/review");
    await page.evaluate((reviewState) => {
      window.history.replaceState(
        { ...window.history.state, usr: reviewState },
        "",
      );
    }, {
      assetCreationReview: {
        request: {
          goal: "image",
          projectId: project.id,
          prompt: "A manual-only request",
          improvePrompt: true,
          maximumUsd: 10,
          idempotencyKey: "asset-studio:proposal:manual-only",
        },
        proposal: null,
        autoApprovalAllowed: false,
      },
    });
    await page.reload();

    await expect(page.getByRole("heading", { name: "Approve this" })).toBeVisible();
    await expect(page.getByText("A manual-only proposal")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve this" })).toBeEnabled();
    await expect(page.getByText(/Starting automatically in/)).toHaveCount(0);
    await page.clock.fastForward(10_000);
    expect(confirmationCount).toBe(0);
  });

  test("stops automatic retry after failure and allows a successful manual retry", async ({ page }) => {
    let confirmationCount = 0;
    await page.clock.install();
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/proposals`,
      (route) => fulfillJson(route, {
        proposal: {
          sessionId: "session_retry",
          runId: "run_retry",
          gateId: "gate_retry",
          requestDigest: "digest_retry",
          maximumUsd: 10,
          approvalToken: "approval_retry",
          expiresAt: "2099-07-31T18:00:00.000Z",
          effectivePrompt: "A considered editorial still",
          enhancementApplied: true,
        },
      }, 201),
    );
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/proposals/gate_retry/confirm`,
      (route) => {
        confirmationCount += 1;
        if (confirmationCount === 2) {
          return fulfillJson(
            route,
            { sessionId: "session_retry", runId: "run_retry", enqueued: true },
            202,
          );
        }
        return fulfillJson(route, {
          error: {
            code: "confirmation_failed",
            message: "The approval could not be recorded. Try again.",
          },
        }, 500);
      },
    );
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/run_retry`,
      (route) => fulfillJson(route, {
        sessionId: "session_retry",
        run: { id: "run_retry", status: "queued", inputSummary: "A considered editorial still" },
        report: null,
        outputs: [],
      }),
    );

    await page.goto("/create/asset");
    await openProjectPicker(page);
    await page.getByRole("button", { name: project.name, exact: true }).click();
    await page.getByLabel("Describe the result", { exact: true }).fill("A considered still");
    await page.getByRole("button", { name: "Review request" }).click();
    await page.getByRole("button", { name: "Approve this" }).click();

    await expect(page.locator("main").getByRole("alert")).toContainText(
      "approval could not be recorded",
    );
    await page.goBack();
    await expect(page).toHaveURL(/\/create\/asset$/);
    await page.goForward();
    await expect(page.getByRole("button", { name: "Approve this" })).toBeEnabled();
    await expect(page.getByText(/Starting automatically in/)).toHaveCount(0);
    await page.clock.fastForward(10_000);
    expect(confirmationCount).toBe(1);
    await page.getByRole("button", { name: "Approve this" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/create/asset\\?projectId=${project.id}&runId=run_retry$`),
    );
    expect(confirmationCount).toBe(2);
  });

  test("revising a visible proposal cancels automatic approval", async ({ page }) => {
    let confirmationCount = 0;
    await page.clock.install();
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/proposals`,
      (route) => fulfillJson(route, {
        proposal: {
          sessionId: "session_revise",
          runId: "run_revise",
          gateId: "gate_revise",
          requestDigest: "digest_revise",
          maximumUsd: 10,
          approvalToken: "approval_revise",
          expiresAt: "2099-07-31T18:00:00.000Z",
          effectivePrompt: "A revised editorial still",
          enhancementApplied: true,
        },
      }, 201),
    );
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/proposals/gate_revise/confirm`,
      (route) => {
        confirmationCount += 1;
        return route.abort();
      },
    );

    await page.goto("/create/asset");
    await openProjectPicker(page);
    await page.getByRole("button", { name: project.name, exact: true }).click();
    await page.getByLabel("Describe the result", { exact: true }).fill("A draft to revise");
    await page.getByRole("button", { name: "Review request" }).click();
    await expect(page.getByText("Starting automatically in 10 seconds.")).toBeVisible();
    await page.getByRole("button", { name: "Revise request" }).click();

    await expect(page).toHaveURL(/\/create\/asset$/);
    await page.clock.fastForward(10_000);
    expect(confirmationCount).toBe(0);
    await expect(
      page.getByPlaceholder(
        "A quiet amber-lit close-up of popcorn falling into a bowl",
      ),
    ).toHaveValue("A draft to revise");
  });

  test("keeps the review page legible on mobile @mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/proposals`,
      (route) => fulfillJson(route, {
        proposal: {
          sessionId: "session_mobile",
          runId: "run_mobile",
          gateId: "gate_mobile",
          requestDigest: "digest_mobile",
          maximumUsd: 10,
          approvalToken: "approval_mobile",
          expiresAt: "2099-07-31T18:00:00.000Z",
          effectivePrompt: "Vertical editorial close-up with restrained amber light.",
          enhancementApplied: true,
        },
      }, 201),
    );

    await page.goto("/create/asset");
    await openProjectPicker(page);
    await page.getByRole("button", { name: project.name, exact: true }).click();
    await page.getByLabel("Describe the result", { exact: true }).fill("A vertical close-up");
    await page.getByRole("button", { name: "Review request" }).click();

    await expect(page.getByRole("heading", { name: "Approve this" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve this" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Revise request" })).toBeVisible();
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("creates the first project without leaving Asset Studio", async ({ page }) => {
    const firstProject = {
      ...project,
      id: "project_first",
      name: "First campaign",
    };
    await page.unroute("**/api/v1/projects?**");
    await page.route("**/api/v1/projects?**", (route) =>
      fulfillJson(route, {
        projects: [],
        pagination: { limit: 100, nextCursor: null },
      }),
    );
    await page.route("**/api/v1/projects", (route) =>
      route.request().method() === "POST"
        ? fulfillJson(route, { project: firstProject }, 201)
        : route.fallback(),
    );

    await page.goto("/create/asset");
    const trigger = page.getByRole("button", {
      name: "Project Create your first project",
    });
    await trigger.click();
    await expect(page.getByLabel("Project name")).toBeFocused();
    await page.getByLabel("Project name").fill(firstProject.name);
    await page.getByRole("button", { name: "Create project" }).click();

    await expect(page).toHaveURL(/\/create\/asset$/);
    await expect(
      page.getByRole("button", {
        name: `Project ${firstProject.name}`,
        exact: true,
      }),
    ).toBeVisible();
  });

  test("shows project-list failure and recovers with Retry", async ({ page }) => {
    let listAttempts = 0;
    await page.unroute("**/api/v1/projects?**");
    await page.route("**/api/v1/projects?**", (route) => {
      listAttempts += 1;
      if (listAttempts === 1) {
        return fulfillJson(
          route,
          {
            error: {
              code: "project_list_failed",
              message: "Projects are unavailable.",
              retryable: true,
            },
          },
          400,
        );
      }
      return fulfillJson(route, {
        projects: [project],
        pagination: { limit: 100, nextCursor: null },
      });
    });

    await page.goto("/create/asset");
    await page
      .getByRole("button", { name: "Project Choose a project" })
      .click();
    await expect(
      page.getByRole("alert").getByText("Projects could not be loaded."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(
      page.getByRole("button", { name: project.name, exact: true }),
    ).toBeVisible();
    expect(listAttempts).toBe(2);
  });

  test("keeps loaded projects visible when loading the next page fails", async ({
    page,
  }) => {
    const secondProject = {
      ...project,
      id: "project_second_page",
      name: "Second page project",
    };
    let nextPageAttempts = 0;
    await page.unroute("**/api/v1/projects?**");
    await page.route("**/api/v1/projects?**", (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      if (!cursor) {
        return fulfillJson(route, {
          projects: [project],
          pagination: { limit: 100, nextCursor: "cursor_page_2" },
        });
      }
      nextPageAttempts += 1;
      if (nextPageAttempts === 1) {
        return fulfillJson(
          route,
          {
            error: {
              code: "project_page_failed",
              message: "The next project page is unavailable.",
              retryable: true,
            },
          },
          400,
        );
      }
      return fulfillJson(route, {
        projects: [secondProject],
        pagination: { limit: 100, nextCursor: null },
      });
    });

    await page.goto("/create/asset");
    await openProjectPicker(page);
    const picker = page.getByLabel("Choose or create a project");
    await expect(
      picker.getByRole("button", { name: project.name, exact: true }),
    ).toBeVisible();
    await picker.getByRole("button", { name: "Load more projects" }).click();

    await expect(
      picker.getByRole("alert").getByText("More projects could not be loaded."),
    ).toBeVisible();
    await expect(
      picker.getByRole("button", { name: project.name, exact: true }),
    ).toBeVisible();
    await picker.getByRole("button", { name: "Retry loading more" }).click();
    await expect(
      picker.getByRole("button", { name: secondProject.name, exact: true }),
    ).toBeVisible();
    expect(nextPageAttempts).toBe(2);
  });

  test("keeps a project name after creation fails and allows retry", async ({ page }) => {
    const retryProject = {
      ...project,
      id: "project_retry",
      name: "Retry campaign",
    };
    let createAttempts = 0;
    await page.route("**/api/v1/projects", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      createAttempts += 1;
      if (createAttempts === 1) {
        return fulfillJson(
          route,
          {
            error: {
              code: "project_create_failed",
              message: "Project creation failed.",
              retryable: true,
            },
          },
          400,
        );
      }
      return fulfillJson(route, { project: retryProject }, 201);
    });

    await page.goto("/create/asset");
    await openProjectPicker(page);
    await page.getByRole("button", { name: "Create new project" }).click();
    const nameInput = page.getByLabel("Project name");
    await nameInput.fill(retryProject.name);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(
      page
        .getByLabel("Choose or create a project")
        .getByRole("alert"),
    ).toContainText("Project creation failed.");
    await expect(nameInput).toHaveValue(retryProject.name);

    await page.getByRole("button", { name: "Create project" }).click();
    await expect(
      page.getByRole("button", {
        name: `Project ${retryProject.name}`,
        exact: true,
      }),
    ).toBeVisible();
    expect(createAttempts).toBe(2);
  });

  test("mobile Create can enter Asset Studio and stays active @mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");

    const createTab = page
      .getByRole("navigation", { name: "Primary mobile" })
      .getByRole("link", { name: "Create", exact: true });
    await createTab.click();

    await expect(page).toHaveURL(/\/create$/);
    await page.getByRole("link", { name: "Create an asset" }).click();
    await expect(page).toHaveURL(/\/create\/asset$/);
    await expect(createTab).toHaveAttribute("aria-current", "page");
    const recentStrip = page.getByRole("navigation", { name: "Recent projects" });
    const context = page.getByLabel("Creation context");
    const canvas = page.getByLabel("Creation prompt");
    const recentBox = await recentStrip.boundingBox();
    const contextBox = await context.boundingBox();
    const canvasBox = await canvas.boundingBox();
    expect(recentBox).not.toBeNull();
    expect(contextBox).not.toBeNull();
    expect(canvasBox).not.toBeNull();
    expect(recentBox!.width).toBeLessThanOrEqual(390);
    expect(contextBox!.y + contextBox!.height).toBeLessThanOrEqual(canvasBox!.y + 1);
    const mobileOverflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(mobileOverflow.scrollWidth).toBe(mobileOverflow.clientWidth);
    await expect(
      page.getByRole("radio", {
        name: "Image",
        exact: true,
      }),
    ).toBeChecked();
    await expectCreationTypeTargets(page);

    const trigger = await openProjectPicker(page);
    const triggerBox = await trigger.boundingBox();
    expect(triggerBox).not.toBeNull();
    expect(triggerBox!.width).toBeGreaterThan(300);
    expect(triggerBox!.width).toBeLessThanOrEqual(358);
    await page.getByRole("button", { name: "Create new project" }).click();
    await expect(page.getByLabel("Project name")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create project" })).toBeVisible();
  });
});
