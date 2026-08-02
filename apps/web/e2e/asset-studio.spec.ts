import { expect, test, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mockLocalApi, now, workspaceId } from "./fixtures/local-api";

const project = {
  id: "project_asset_studio",
  schemaVersion: "project.v1",
  workspaceId,
  name: "Campaign stills",
  status: "active",
  visibility: "private",
  posterUrl:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 90'%3E%3Crect width='160' height='90' fill='%232a2440'/%3E%3C/svg%3E",
  createdAt: now,
  updatedAt: now,
};

const longRunSummary =
  "Create a single-panel 2D RPG boss illustration in a clear 1990s pixel-art sprite-sheet style. Keep the composition focused, avoid glossy modern effects, emphasize a readable silhouette, and use a restrained brass, blue, and ember palette with deliberate one-pixel edges.";

const recentProject = {
  ...project,
  id: "project_recent",
  name: "Midnight Drive",
  posterUrl: null,
  updatedAt: "2025-01-01T00:00:00.000Z",
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockAssetStudioProject(page: Page) {
  await page.route("**/api/v1/projects?**", (route) => {
    expect(new URL(route.request().url()).searchParams.get("order")).toBe("updatedAt");
    return fulfillJson(route, {
      projects: [recentProject, project],
      pagination: { limit: 100, nextCursor: null },
    });
  });
}

async function openProjectPicker(page: Page) {
  const trigger = page.getByRole("button", { name: /^Project / });
  await trigger.click();
  await expect(page.getByRole("searchbox", { name: "Find a project" })).toBeFocused();
  return trigger;
}

async function expectCreationTypeTargets(page: Page) {
  const targets = await page.getByRole("radio").evaluateAll((inputs) =>
    inputs.map((input) => {
      const label = input.closest("label");
      if (!label) throw new Error("Creation type radio is missing its label");
      const box = label.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }),
  );

  expect(targets).toHaveLength(3);
  for (const target of targets) {
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
  }
}

test.describe("Asset Studio", () => {
  test("keeps progress artwork within its compact asset budget", () => {
    const assets = [
      { name: "director-crew.png", width: 423, height: 141 },
      { name: "camera-crew.png", width: 423, height: 141 },
      { name: "actor-crew.png", width: 423, height: 141 },
      { name: "actress-crew.png", width: 423, height: 141 },
      { name: "studio-set.png", width: 640, height: 320 },
    ];
    let totalBytes = 0;

    for (const asset of assets) {
      const image = readFileSync(
        new URL(`../public/sprites/progress/${asset.name}`, import.meta.url),
      );
      expect(image.subarray(1, 4).toString()).toBe("PNG");
      expect(image.readUInt32BE(16)).toBe(asset.width);
      expect(image.readUInt32BE(20)).toBe(asset.height);
      totalBytes += image.byteLength;
    }

    expect(totalBytes).toBeLessThan(512 * 1024);
  });

  test.beforeEach(async ({ page }) => {
    await mockLocalApi(page);
    await mockAssetStudioProject(page);
  });

  test("uses the selected recent project in the split creation workspace", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/create/asset");

    const context = page.getByLabel("Creation context");
    const canvas = page.getByLabel("Creation prompt");
    const contextBox = await context.boundingBox();
    const canvasBox = await canvas.boundingBox();
    expect(contextBox).not.toBeNull();
    expect(canvasBox).not.toBeNull();
    const workspaceWidth = contextBox!.width + canvasBox!.width;
    expect(contextBox!.width / workspaceWidth).toBeGreaterThan(0.26);
    expect(contextBox!.width / workspaceWidth).toBeLessThan(0.34);
    expect(canvasBox!.width / workspaceWidth).toBeGreaterThan(0.66);

    await expect(page.getByRole("navigation", { name: "Recent projects" })).toBeVisible();
    const recentProjectOrder = await page
      .getByRole("navigation", { name: "Recent projects" })
      .getByRole("button")
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label")));
    expect(recentProjectOrder).toEqual([
      `Use recent project ${project.name}`,
      `Use recent project ${recentProject.name}`,
    ]);
    await expect(
      page.getByRole("button", { name: `Use recent project ${project.name}` }),
    ).toContainText(project.name);
    const noPosterProject = page.getByRole("button", {
      name: `Use recent project ${recentProject.name}`,
    });
    await expect(noPosterProject.locator("img")).toHaveCount(0);
    await expect(noPosterProject.getByText("M", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: `Use recent project ${project.name}` })
      .click();

    await expect(
      page.getByRole("article", { name: `Selected project ${project.name}` }),
    ).toBeVisible();
    await expect(
      page.getByRole("article", { name: `Selected project ${project.name}` }).locator("img"),
    ).toHaveAttribute("src", project.posterUrl);
    await expect(
      page.getByRole("button", { name: `Project ${project.name}`, exact: true }),
    ).toBeVisible();

    const promptBox = await page.getByLabel("Describe the result").boundingBox();
    expect(promptBox).not.toBeNull();
    expect(promptBox!.height).toBeGreaterThanOrEqual(260);
    await expect(page.getByRole("button", { name: "Review request" })).toBeDisabled();
    await expectCreationTypeTargets(page);

    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(overflow.scrollWidth).toBe(overflow.clientWidth);
  });

  test("creates an AI-named project automatically when review has no project selection @mobile", async ({
    page,
  }) => {
    const automaticProject = {
      ...project,
      id: "project_automatic",
      name: "Amber Popcorn Study",
    };
    let createCount = 0;
    let namingInput: Record<string, unknown> | null = null;
    let projectIdempotencyKey: string | undefined;
    let releaseCreate: (() => void) | undefined;
    const createReleased = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });

    await page.route("**/api/v1/projects", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      createCount += 1;
      namingInput = route.request().postDataJSON();
      projectIdempotencyKey = route.request().headers()["idempotency-key"];
      await createReleased;
      await fulfillJson(route, { project: automaticProject }, 201);
    });
    await page.route(
      `**/api/v1/projects/${automaticProject.id}/agent-creations/proposals`,
      (route) =>
        fulfillJson(
          route,
          {
            proposal: {
              sessionId: "session_automatic",
              runId: "run_automatic",
              gateId: "gate_automatic",
              requestDigest: "digest_automatic",
              maximumUsd: 10,
              approvalToken: "approval_automatic",
              expiresAt: "2099-07-31T18:00:00.000Z",
              effectivePrompt: "Quiet amber-lit popcorn falling into a bowl",
              enhancementApplied: true,
            },
          },
          201,
        ),
    );

    await page.goto("/create/asset");
    await expect(
      page.getByText("Optional — we’ll create and name one when you review."),
    ).toBeVisible();
    const prompt = page.getByLabel("Describe the result", { exact: true });
    await prompt.fill("Quiet amber-lit popcorn falling into a bowl");
    await openProjectPicker(page);
    await page.getByRole("button", { name: "Create new project" }).click();
    await expect(
      page.getByLabel("Project name"),
    ).toBeVisible();
    const review = page.getByRole("button", { name: "Review request" });
    await expect(review).toBeEnabled();
    await review.evaluate((button) => {
      button.click();
      button.click();
    });

    await expect(
      page.getByRole("button", { name: "Creating project…" }),
    ).toBeDisabled();
    await expect(page.locator("textarea")).toBeDisabled();
    await expect(
      page.getByLabel("Project name"),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: `Use recent project ${project.name}`,
      }),
    ).toBeDisabled();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
    expect(createCount).toBe(1);
    expect(namingInput).toEqual({
      namingPrompt: "Quiet amber-lit popcorn falling into a bowl",
      namingContext: "image",
    });
    expect(projectIdempotencyKey).toMatch(/^asset-studio:project:/);

    releaseCreate?.();
    await expect(page).toHaveURL(/\/create\/review$/);
    await expect(
      page.getByRole("heading", { name: "Approve this" }),
    ).toBeVisible();
    expect(createCount).toBe(1);
  });

  test("does not open review when automatic project creation finishes after leaving Create", async ({
    page,
  }) => {
    const automaticProject = {
      ...project,
      id: "project_abandoned_automatic",
      name: "Abandoned Automatic Project",
    };
    let releaseCreate: (() => void) | undefined;
    let markCreateCompleted: (() => void) | undefined;
    const createReleased = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const createCompleted = new Promise<void>((resolve) => {
      markCreateCompleted = resolve;
    });

    await page.route("**/api/v1/projects", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await createReleased;
      await fulfillJson(route, { project: automaticProject }, 201);
      markCreateCompleted?.();
    });

    await page.goto("/create/asset");
    await page
      .getByLabel("Describe the result", { exact: true })
      .fill("A request the creator leaves behind");
    await page.getByRole("button", { name: "Review request" }).click();
    await expect(
      page.getByRole("button", { name: "Creating project…" }),
    ).toBeDisabled();

    await page
      .getByRole("complementary")
      .getByRole("link", { name: "Dashboard", exact: true })
      .click();
    await expect(page).toHaveURL(/\/dashboard$/);
    releaseCreate?.();
    await createCompleted;
    await page.waitForTimeout(100);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(
      page.getByRole("heading", { name: "Approve this" }),
    ).toHaveCount(0);
  });

  test("preserves the draft when automatic project creation fails", async ({ page }) => {
    const automaticProject = {
      ...project,
      id: "project_retry_automatic",
      name: "Red Bicycle Orbit",
    };
    const idempotencyKeys: Array<string | undefined> = [];
    let createAttempts = 0;
    await page.route("**/api/v1/projects", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      createAttempts += 1;
      idempotencyKeys.push(route.request().headers()["idempotency-key"]);
      return createAttempts === 1
        ? fulfillJson(
            route,
            {
              error: {
                code: "project_create_failed",
                message: "Naming service is unavailable.",
                retryable: true,
              },
            },
            503,
          )
        : fulfillJson(route, { project: automaticProject }, 201);
    });
    await page.route(
      `**/api/v1/projects/${automaticProject.id}/agent-creations/proposals`,
      (route) =>
        fulfillJson(route, {
          proposal: {
            sessionId: "session_retry_automatic",
            runId: "run_retry_automatic",
            gateId: "gate_retry_automatic",
            requestDigest: "digest_retry_automatic",
            maximumUsd: 10,
            approvalToken: "approval_retry_automatic",
            expiresAt: "2099-07-31T18:00:00.000Z",
            effectivePrompt: "A slow orbit around a red bicycle",
            enhancementApplied: true,
          },
        }, 201),
    );

    await page.goto("/create/asset");
    await page
      .getByRole("radio", { name: /Video/ })
      .evaluate((radio: HTMLInputElement) => radio.click());
    const prompt = page.getByLabel("Describe the result", { exact: true });
    await prompt.fill("A slow orbit around a red bicycle");
    await page.getByRole("button", { name: "Review request" }).click();

    await expect(page).toHaveURL(/\/create\/asset$/);
    await expect(page.locator("main").getByRole("alert")).toContainText(
      "We couldn’t create a project automatically",
    );
    await expect(
      page.getByRole("textbox", { name: "Describe the result" }),
    ).toHaveValue("A slow orbit around a red bicycle");
    await expect(page.getByRole("radio", { name: /Video/ })).toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: /Improve video prompt/ }),
    ).toBeChecked();
    await expect(
      page.getByRole("button", { name: "Review request" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Review request" }).click();
    await expect(page).toHaveURL(/\/create\/review$/);
    expect(createAttempts).toBe(2);
    expect(idempotencyKeys[0]).toMatch(/^asset-studio:project:/);
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
  });

  test("shows recent-project loading placeholders without duplicating project recovery", async ({ page }) => {
    let releaseProjects: (() => void) | undefined;
    const projectsReleased = new Promise<void>((resolve) => {
      releaseProjects = resolve;
    });
    await page.unroute("**/api/v1/projects?**");
    await page.route("**/api/v1/projects?**", async (route) => {
      await projectsReleased;
      await fulfillJson(route, {
        projects: [project],
        pagination: { limit: 100, nextCursor: null },
      });
    });

    await page.goto("/create/asset");
    await expect(page.getByRole("navigation", { name: "Recent projects" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Use recent project ${project.name}` }),
    ).toHaveCount(0);

    releaseProjects?.();
    await expect(
      page.getByRole("button", { name: `Use recent project ${project.name}` }),
    ).toBeVisible();
  });

  test("omits the recent-project strip when no projects exist", async ({ page }) => {
    await page.unroute("**/api/v1/projects?**");
    await page.route("**/api/v1/projects?**", (route) =>
      fulfillJson(route, {
        projects: [],
        pagination: { limit: 100, nextCursor: null },
      }),
    );

    await page.goto("/create/asset");
    await expect(page.getByRole("navigation", { name: "Recent projects" })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Project Create your first project" }),
    ).toBeVisible();
  });

  test("retries a recent-project poster when its signed URL changes", async ({ page }) => {
    const expiredPosterUrl = "/expired-project-poster.svg";
    const freshPosterUrl =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 90'%3E%3Crect width='160' height='90' fill='%234d3a72'/%3E%3C/svg%3E";
    let posterUrl = expiredPosterUrl;

    await page.unroute("**/api/v1/projects?**");
    await page.route("**/api/v1/projects?**", (route) =>
      fulfillJson(route, {
        projects: [{ ...project, posterUrl }],
        pagination: { limit: 100, nextCursor: null },
      }),
    );
    await page.route("**/expired-project-poster.svg", (route) =>
      route.fulfill({ status: 410 }),
    );
    await page.route("**/api/v1/projects", (route) => {
      posterUrl = freshPosterUrl;
      return fulfillJson(
        route,
        {
          project: {
            ...project,
            id: "new-project",
            name: "New project",
            posterUrl: null,
          },
        },
        201,
      );
    });

    await page.goto("/create/asset");
    const recent = page.getByRole("button", {
      name: `Use recent project ${project.name}`,
    });
    await expect(recent.locator("img")).toHaveCount(0);
    await expect(recent.getByText("C", { exact: true })).toBeVisible();

    await openProjectPicker(page);
    await page.getByRole("button", { name: "Create new project" }).click();
    await page.getByLabel("Project name").fill("New project");
    await page.getByRole("button", { name: "Create project" }).click();

    await expect(recent.locator("img")).toHaveAttribute("src", freshPosterUrl);
  });

  test("moves prompt refinement to review and manual approval dispatches once", async ({ page }) => {
    let proposalKind: string | null = null;
    let proposalPrompt: string | null = null;
    let improvePrompt: boolean | null = null;
    let confirmationCount = 0;
    let projectCreateCount = 0;
    let releaseProposal: (() => void) | undefined;
    const proposalReleased = new Promise<void>((resolve) => {
      releaseProposal = resolve;
    });
    let releaseConfirmation: (() => void) | undefined;
    const confirmationReleased = new Promise<void>((resolve) => {
      releaseConfirmation = resolve;
    });

    await page.clock.install();

    await page.route("**/api/v1/projects", (route) => {
      if (route.request().method() === "POST") projectCreateCount += 1;
      return route.fallback();
    });

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
              expiresAt: "2099-07-31T18:00:00.000Z",
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
            inputSummary: longRunSummary,
          },
          report: null,
          outputs: [],
        }),
    );

    await page.goto("/dashboard");
    await page
      .getByRole("complementary")
      .getByRole("link", { name: "Create", exact: true })
      .click();
    await expect(page).toHaveURL(/\/create$/);
    await page.getByRole("link", { name: "Create an asset" }).click();
    await expect(page).toHaveURL(/\/create\/asset$/);
    await expect(
      page.getByRole("radio", {
        name: "Image A still visual for this project.",
      }),
    ).toBeChecked();
    await expectCreationTypeTargets(page);

    const projectTrigger = await openProjectPicker(page);
    await page.keyboard.press("Escape");
    await expect(projectTrigger).toBeFocused();
    await projectTrigger.click();
    await page.getByRole("button", { name: project.name, exact: true }).click();
    await expect(projectTrigger).toHaveAccessibleName(`Project ${project.name}`);
    await page
      .getByLabel("Describe the result", { exact: true })
      .fill("An amber-lit editorial popcorn still");
    await page.getByRole("button", { name: "Review request" }).click();

    await expect(page).toHaveURL(/\/create\/review$/);
    expect(projectCreateCount).toBe(0);
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
      new RegExp(`/create/asset\\?projectId=${project.id}&runId=run_image$`),
    );
    await expect(page.getByText("Queued", { exact: true })).toBeVisible();
    await expect(page.getByTestId("studio-crew")).toBeVisible();
    await expect(page.getByTestId("studio-set")).toHaveCSS(
      "background-image",
      /studio-set\.png/,
    );
    await expect(page.locator("[data-crew-member]")).toHaveCount(4);
    await expect(page.getByTestId("creation-progress-track")).toBeVisible();
    const crewResources = await page.locator("[data-crew-member]").evaluateAll((actors) =>
      actors.map((actor) => {
        const sprite = actor.firstElementChild;
        return sprite ? getComputedStyle(sprite).backgroundImage : "";
      }),
    );
    expect(crewResources).toEqual([
      expect.stringContaining("/sprites/progress/director-crew.png"),
      expect.stringContaining("/sprites/progress/camera-crew.png"),
      expect.stringContaining("/sprites/progress/actor-crew.png"),
      expect.stringContaining("/sprites/progress/actress-crew.png"),
    ]);
    expect(crewResources.some((name) => name.includes("-sprite-sheet.png"))).toBe(false);
    const performanceBlocking = await page.evaluate(() => {
      const centerOf = (role: string) => {
        const actor = document.querySelector<HTMLElement>(
          `[data-crew-member='${role}']`,
        );
        if (!actor) throw new Error(`Missing ${role} crew member`);
        const box = actor.getBoundingClientRect();
        return box.left + box.width / 2;
      };
      const actorSprite = document.querySelector<HTMLElement>(
        "[data-crew-member='actor'] > div",
      );
      const actressSprite = document.querySelector<HTMLElement>(
        "[data-crew-member='actress'] > div",
      );
      if (!actorSprite || !actressSprite) throw new Error("Missing performer sprite");
      return {
        camera: centerOf("camera"),
        actor: centerOf("actor"),
        actress: centerOf("actress"),
        actorTransform: getComputedStyle(actorSprite).transform,
        actressTransform: getComputedStyle(actressSprite).transform,
      };
    });
    expect(performanceBlocking.actorTransform).toBe("none");
    expect(performanceBlocking.actressTransform).toBe(
      "matrix(-1, 0, 0, 1, 0, 0)",
    );
    expect(performanceBlocking.actress).toBeGreaterThan(performanceBlocking.actor);
    expect(performanceBlocking.actress - performanceBlocking.actor).toBeLessThan(
      performanceBlocking.actor - performanceBlocking.camera,
    );
    const brief = page.getByLabel("View full request brief");
    await expect(brief).toContainText("Create a single-panel 2D RPG boss");
    await expect(brief).toContainText("…");
    await expect(page.getByText(longRunSummary, { exact: true })).toBeHidden();
    await brief.click();
    await expect(page.getByText(longRunSummary, { exact: true })).toBeVisible();
    expect(confirmationCount).toBe(1);
  });

  test("keeps the progress state truthful across terminal outcomes", async ({ page }) => {
    let status: "failed" | "canceled" | "succeeded" | "blocked" | "question" =
      "failed";
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/run_terminal`,
      (route) => {
        const isBlocked = status === "blocked";
        const isQuestion = status === "question";
        return fulfillJson(route, {
          sessionId: "session_terminal",
          run: {
            id: "run_terminal",
            status: isBlocked || isQuestion ? "waiting" : status,
          },
          report: isBlocked
            ? {
                schemaVersion: "DomainReport.v1",
                outcome: {
                  outcome: "blocked",
                  precondition: {
                    requirement: "Choose a visual direction",
                    because: "The references point in two different directions",
                  },
                  requiredDomain: "visuals",
                  targets: [],
                  reason: "Choose between the warm and monochrome directions.",
                },
              }
            : isQuestion
              ? {
                  schemaVersion: "DomainReport.v1",
                  outcome: {
                    outcome: "question",
                    question: "Should the poster feel playful or ominous?",
                    targets: [],
                    options: [],
                    fingerprint: "question_fingerprint",
                  },
                }
              : null,
          outputs:
            status === "succeeded"
              ? [{ assetId: "asset_ready", intrinsicRole: "hero_image" }]
              : [],
        });
      },
    );

    await page.goto(`/create/asset?projectId=${project.id}&runId=run_terminal`);
    await expect(
      page.getByRole("heading", { name: "The studio hit a snag" }),
    ).toBeVisible();
    await expect(page.getByTestId("studio-crew")).not.toHaveAttribute(
      "data-active",
    );
    await expect(page.getByTestId("creation-progress-track")).toHaveCount(0);
    const idleFrame = await page
      .locator('[data-crew-member="director"]')
      .locator("div")
      .evaluate((sprite) => getComputedStyle(sprite).backgroundPositionX);
    expect(idleFrame).toBe("0px");
    await expect(page.getByText("This page updates automatically.")).toHaveCount(
      0,
    );
    await expect(page.getByLabel("View full request brief")).toHaveCount(0);

    status = "canceled";
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Creation stopped" }),
    ).toBeVisible();
    await expect(page.getByText("This page updates automatically.")).toHaveCount(
      0,
    );

    status = "blocked";
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "The studio needs a decision" }),
    ).toBeVisible();
    await expect(
      page.getByText("Choose between the warm and monochrome directions."),
    ).toBeVisible();
    await expect(page.getByText("This page updates automatically.")).toHaveCount(
      0,
    );

    status = "question";
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "The studio has a question" }),
    ).toBeVisible();
    await expect(
      page.getByText("Should the poster feel playful or ominous?"),
    ).toBeVisible();
    await expect(page.getByText("This page updates automatically.")).toHaveCount(
      0,
    );

    status = "succeeded";
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Your asset is ready" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open project assets" }),
    ).toBeVisible();
    await expect(page.getByText("1 asset is ready.")).toBeVisible();
    await expect(page.getByTestId("creation-progress-track")).toHaveCount(0);
  });

  test("keeps the active crew calm and contained on mobile with reduced motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/run_mobile`,
      (route) =>
        fulfillJson(route, {
          sessionId: "session_mobile",
          run: {
            id: "run_mobile",
            status: "running",
            inputSummary: longRunSummary,
          },
          report: null,
          outputs: [],
        }),
    );

    await page.goto(`/create/asset?projectId=${project.id}&runId=run_mobile`);
    await expect(page.getByText("In progress", { exact: true })).toBeVisible();
    const spriteAnimation = await page
      .locator('[data-crew-member="director"]')
      .locator("div")
      .evaluate((sprite) => getComputedStyle(sprite).animationName);
    expect(spriteAnimation).toBe("none");
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);

    await page.setViewportSize({ width: 320, height: 800 });
    const narrowBounds = await page.evaluate(() => {
      const scene = document.querySelector<HTMLElement>("[data-testid='studio-crew']");
      if (!scene) throw new Error("Studio crew scene is missing");
      const sceneBox = scene.getBoundingClientRect();
      return {
        scene: { left: sceneBox.left, right: sceneBox.right },
        actors: Array.from(
          document.querySelectorAll<HTMLElement>("[data-crew-member]"),
        ).map((actor) => {
          const box = actor.getBoundingClientRect();
          return { left: box.left, right: box.right };
        }),
      };
    });
    for (const actor of narrowBounds.actors) {
      expect(actor.left).toBeGreaterThanOrEqual(narrowBounds.scene.left - 1);
      expect(actor.right).toBeLessThanOrEqual(narrowBounds.scene.right + 1);
    }
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
              expiresAt: "2099-07-31T18:00:00.000Z",
              effectivePrompt: originalPrompt,
              enhancementApplied: false,
            },
          },
          201,
        );
      },
    );

    await page.goto("/create/asset");
    await openProjectPicker(page);
    await page.getByRole("button", { name: project.name, exact: true }).click();
    await page
      .getByLabel("Describe the result", { exact: true })
      .fill(originalPrompt);
    const improve = page.getByRole("checkbox", {
      name: /Improve image prompt/,
    });
    await expect(improve).toBeChecked();
    await improve.uncheck();
    await page.getByRole("button", { name: "Review request" }).click();

    await expect(page).toHaveURL(/\/create\/review$/);
    await expect(page.getByText("Prompt", { exact: true })).toBeVisible();
    await expect(page.getByText("Refined prompt", { exact: true })).toHaveCount(0);
    expect(requestBody).toMatchObject({
      kind: "image_create",
      prompt: originalPrompt,
      improvePrompt: false,
    });
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
