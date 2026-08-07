import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
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
});
