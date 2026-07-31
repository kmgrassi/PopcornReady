import { expect, test, type Page, type Route } from "@playwright/test";
import { mockLocalApi, now, workspaceId } from "./fixtures/local-api";

const project = {
  id: "project_asset_studio",
  schemaVersion: "project.v1",
  workspaceId,
  name: "Campaign stills",
  status: "active",
  visibility: "private",
  createdAt: now,
  updatedAt: now,
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockAssetStudioProject(page: Page) {
  await page.route("**/api/v1/projects?**", (route) =>
    fulfillJson(route, {
      projects: [project],
      pagination: { limit: 100, nextCursor: null },
    }),
  );
}

async function openProjectPicker(page: Page) {
  const trigger = page.getByRole("button", { name: /^Project / });
  await trigger.click();
  await expect(page.getByRole("searchbox", { name: "Find a project" })).toBeFocused();
  return trigger;
}

async function expectChoiceCardPadding(page: Page) {
  const padding = await page.getByRole("radio").evaluateAll((inputs) => {
    const expected = getComputedStyle(document.documentElement)
      .getPropertyValue("--space-4")
      .trim();
    const cards = inputs.map((input) => {
      const card = input.closest("label");
      if (!card) throw new Error("Choice card radio is missing its label");
      const style = getComputedStyle(card);
      return {
        inlineStart: style.paddingInlineStart,
        inlineEnd: style.paddingInlineEnd,
      };
    });
    return { expected, cards };
  });

  expect(padding.cards).toHaveLength(3);
  for (const card of padding.cards) {
    expect(card.inlineStart).toBe(padding.expected);
    expect(card.inlineEnd).toBe(padding.expected);
  }
}

test.describe("Asset Studio", () => {
  test.beforeEach(async ({ page }) => {
    await mockLocalApi(page);
    await mockAssetStudioProject(page);
  });

  test("moves prompt refinement to review and manual approval dispatches once", async ({ page }) => {
    let proposalKind: string | null = null;
    let proposalPrompt: string | null = null;
    let improvePrompt: boolean | null = null;
    let confirmationCount = 0;
    let releaseProposal: (() => void) | undefined;
    const proposalReleased = new Promise<void>((resolve) => {
      releaseProposal = resolve;
    });
    let releaseConfirmation: (() => void) | undefined;
    const confirmationReleased = new Promise<void>((resolve) => {
      releaseConfirmation = resolve;
    });

    await page.clock.install();

    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/proposals`,
      async (route) => {
        const request = route.request();
        const body = request.postDataJSON();
        proposalKind = body.kind;
        proposalPrompt = body.prompt;
        improvePrompt = body.improvePrompt;
        expect(request.headers()["idempotency-key"]).toMatch(/^asset-studio:proposal:/);
        await proposalReleased;
        await fulfillJson(
          route,
          {
            proposal: {
              sessionId: "session_image",
              runId: "run_image",
              gateId: "gate_image",
              requestDigest: "digest_image",
              maximumUsd: 10,
              approvalToken: "approval_image",
              expiresAt: "2026-07-29T18:00:00.000Z",
              effectivePrompt:
                "Editorial close-up of popcorn falling into a stoneware bowl. Soft window light from camera-left, restrained amber palette, visible salt crystals, and shallow incidental crumbs.",
              enhancementApplied: true,
            },
          },
          201,
        );
      },
    );
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/proposals/gate_image/confirm`,
      async (route) => {
        confirmationCount += 1;
        await confirmationReleased;
        await fulfillJson(
          route,
          { sessionId: "session_image", runId: "run_image", enqueued: true },
          202,
        );
      },
    );
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/run_image`,
      (route) =>
        fulfillJson(route, {
          sessionId: "session_image",
          run: {
            id: "run_image",
            status: "queued",
            inputSummary: "An amber-lit editorial popcorn still",
          },
          report: null,
          outputs: [],
        }),
    );

    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Create new asset" }).click();
    await expect(page).toHaveURL(/\/create$/);
    await expect(
      page.getByRole("radio", {
        name: "Image A visual for the project asset pool.",
      }),
    ).toBeChecked();
    await expectChoiceCardPadding(page);

    const projectTrigger = await openProjectPicker(page);
    await page.keyboard.press("Escape");
    await expect(projectTrigger).toBeFocused();
    await projectTrigger.click();
    await page.getByRole("button", { name: project.name, exact: true }).click();
    await expect(projectTrigger).toHaveAccessibleName(`Project ${project.name}`);
    await page
      .getByLabel("What should it feel like?", { exact: true })
      .fill("An amber-lit editorial popcorn still");
    await page.getByRole("button", { name: "Start" }).click();

    await expect(page).toHaveURL(/\/create\/review$/);
    await expect(page.getByRole("heading", { name: "Improving your prompt" })).toBeVisible();
    await expect(page.getByText("Refining the creative direction")).toBeVisible();
    expect(confirmationCount).toBe(0);

    releaseProposal?.();
    await expect(page.getByRole("heading", { name: "Approve this" })).toBeVisible();
    expect(proposalKind).toBe("image_create");
    expect(proposalPrompt).toBe("An amber-lit editorial popcorn still");
    expect(improvePrompt).toBe(true);
    expect(confirmationCount).toBe(0);
    await expect(page.getByText("Original", { exact: true })).toBeVisible();
    await expect(page.getByText("Refined prompt", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/Editorial close-up of popcorn falling into a stoneware bowl/),
    ).toBeVisible();

    await page.getByRole("button", { name: "Approve this" }).click();
    await page.clock.fastForward(10_000);
    expect(confirmationCount).toBe(1);
    releaseConfirmation?.();

    await expect(page).toHaveURL(
      new RegExp(`/create\\?projectId=${project.id}&runId=run_image$`),
    );
    await expect(page.getByText("queued", { exact: true })).toBeVisible();
    expect(confirmationCount).toBe(1);
  });

  test("lets the creator bypass image prompt improvement exactly", async ({ page }) => {
    const originalPrompt = "Flat-lay photo of three blue ceramic buttons";
    let requestBody: Record<string, unknown> | null = null;

    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/proposals`,
      async (route) => {
        requestBody = route.request().postDataJSON();
        await fulfillJson(
          route,
          {
            proposal: {
              sessionId: "session_bypass",
              runId: "run_bypass",
              gateId: "gate_bypass",
              requestDigest: "digest_bypass",
              maximumUsd: 10,
              approvalToken: "approval_bypass",
              expiresAt: "2026-07-29T18:00:00.000Z",
              effectivePrompt: originalPrompt,
              enhancementApplied: false,
            },
          },
          201,
        );
      },
    );

    await page.goto("/create");
    await openProjectPicker(page);
    await page.getByRole("button", { name: project.name, exact: true }).click();
    await page
      .getByLabel("What should it feel like?", { exact: true })
      .fill(originalPrompt);
    const improve = page.getByRole("checkbox", {
      name: /Improve image prompt/,
    });
    await expect(improve).toBeChecked();
    await improve.uncheck();
    await page.getByRole("button", { name: "Start" }).click();

    await expect(page).toHaveURL(/\/create\/review$/);
    await expect(page.getByText("Prompt", { exact: true })).toBeVisible();
    await expect(page.getByText("Refined prompt", { exact: true })).toHaveCount(0);
    expect(requestBody).toMatchObject({
      kind: "image_create",
      prompt: originalPrompt,
      improvePrompt: false,
    });
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

    await page.goto("/create");
    await openProjectPicker(page);
    await page.getByRole("button", { name: project.name, exact: true }).click();
    const prompt = page.getByLabel("What should it feel like?", { exact: true });
    await prompt.fill("A precise campaign still");
    await page.getByRole("button", { name: "Start" }).click();

    await expect(page).toHaveURL(/\/create\/review$/);
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "turn off Improve image prompt",
    );
    await page.getByRole("button", { name: "Revise request" }).click();
    await expect(page).toHaveURL(/\/create$/);
    await expect(
      page.getByPlaceholder(
        "A quiet amber-lit close-up of popcorn falling into a bowl",
      ),
    ).toHaveValue("A precise campaign still");
    await expect(
      page.getByRole("checkbox", { name: /Improve image prompt/ }),
    ).toBeChecked();
    await expect(page.getByRole("button", { name: "Start" })).toBeEnabled();
    await expect(page.getByRole("button", { name: `Project ${project.name}` })).toBeVisible();
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
            expiresAt: "2026-07-31T18:00:00.000Z",
            effectivePrompt: "A restored editorial draft",
            enhancementApplied: true,
          },
        }, 201);
      },
    );

    await page.goto("/create");
    await openProjectPicker(page);
    await page.getByRole("button", { name: project.name, exact: true }).click();
    await page.getByLabel("What should it feel like?", { exact: true }).fill("A restored draft");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("heading", { name: "Improving your prompt" })).toBeVisible();

    await page.goBack();
    releaseProposal?.();
    await expect(page).toHaveURL(/\/create$/);
    await expect(
      page.getByPlaceholder(
        "A quiet amber-lit close-up of popcorn falling into a bowl",
      ),
    ).toHaveValue("A restored draft");
    await expect(page.getByRole("button", { name: `Project ${project.name}` })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Approve this" })).toHaveCount(0);
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
              expiresAt: "2026-07-29T18:00:00.000Z",
            },
          },
          201,
        );
      },
    );

    await page.goto("/create");
    const prompt = page.getByLabel("What should it feel like?", { exact: true });
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

    await page.getByRole("button", { name: "Start" }).click();
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

    await page.goto("/create");
    const projectTrigger = await openProjectPicker(page);
    await page.getByRole("button", { name: "Create new project" }).click();
    await page.getByLabel("Project name").fill(delayedProject.name);
    await page.getByRole("button", { name: "Create project" }).click();
    await createStarted;

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
          expiresAt: "2026-07-31T18:00:00.000Z",
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

    await page.goto("/create");
    await openProjectPicker(page);
    await page.getByRole("button", { name: project.name, exact: true }).click();
    await page.getByLabel("What should it feel like?", { exact: true }).fill("A considered still");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("heading", { name: "Approve this" })).toBeVisible();
    await expect(page.getByText("Starting automatically in 10 seconds.")).toBeVisible();

    await page.clock.fastForward(1_000);
    await expect(page.getByText("Starting automatically in 9 seconds.")).toBeVisible();
    await page.clock.fastForward(8_999);
    expect(confirmationCount).toBe(0);
    await page.clock.fastForward(1);
    await expect.poll(() => confirmationCount).toBe(1);
    await expect(page).toHaveURL(new RegExp(`/create\\?projectId=${project.id}&runId=run_auto$`));
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
          expiresAt: "2026-07-31T18:00:00.000Z",
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

    await page.goto("/create");
    await openProjectPicker(page);
    await page.getByRole("button", { name: project.name, exact: true }).click();
    await page.getByLabel("What should it feel like?", { exact: true }).fill("A considered still");
    await page.getByRole("button", { name: "Start" }).click();
    await page.getByRole("button", { name: "Approve this" }).click();

    await expect(page.locator("main").getByRole("alert")).toContainText(
      "approval could not be recorded",
    );
    await page.clock.fastForward(10_000);
    expect(confirmationCount).toBe(1);
    await expect(page.getByRole("button", { name: "Approve this" })).toBeEnabled();
    await page.getByRole("button", { name: "Approve this" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/create\\?projectId=${project.id}&runId=run_retry$`),
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
          expiresAt: "2026-07-31T18:00:00.000Z",
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

    await page.goto("/create");
    await openProjectPicker(page);
    await page.getByRole("button", { name: project.name, exact: true }).click();
    await page.getByLabel("What should it feel like?", { exact: true }).fill("A draft to revise");
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByText("Starting automatically in 10 seconds.")).toBeVisible();
    await page.getByRole("button", { name: "Revise request" }).click();

    await expect(page).toHaveURL(/\/create$/);
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
          expiresAt: "2026-07-31T18:00:00.000Z",
          effectivePrompt: "Vertical editorial close-up with restrained amber light.",
          enhancementApplied: true,
        },
      }, 201),
    );

    await page.goto("/create");
    await openProjectPicker(page);
    await page.getByRole("button", { name: project.name, exact: true }).click();
    await page.getByLabel("What should it feel like?", { exact: true }).fill("A vertical close-up");
    await page.getByRole("button", { name: "Start" }).click();

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

    await page.goto("/create");
    const trigger = page.getByRole("button", {
      name: "Project Create your first project",
    });
    await trigger.click();
    await expect(page.getByLabel("Project name")).toBeFocused();
    await page.getByLabel("Project name").fill(firstProject.name);
    await page.getByRole("button", { name: "Create project" }).click();

    await expect(page).toHaveURL(/\/create$/);
    await expect(
      page.getByRole("button", { name: `Project ${firstProject.name}` }),
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

    await page.goto("/create");
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

    await page.goto("/create");
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

    await page.goto("/create");
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
      page.getByRole("button", { name: `Project ${retryProject.name}` }),
    ).toBeVisible();
    expect(createAttempts).toBe(2);
  });

  test("mobile Create opens Asset Studio and stays active @mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");

    const createTab = page.getByRole("button", { name: "Create", exact: true });
    await createTab.click();

    await expect(page).toHaveURL(/\/create$/);
    await expect(createTab).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("radio", {
        name: "Image A visual for the project asset pool.",
      }),
    ).toBeChecked();
    await expectChoiceCardPadding(page);

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
