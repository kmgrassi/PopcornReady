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

  test("creates an image only after explicit cost confirmation", async ({ page }) => {
    let proposalKind: string | null = null;
    let confirmationCount = 0;

    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/proposals`,
      async (route) => {
        const request = route.request();
        proposalKind = request.postDataJSON().kind;
        expect(request.headers()["idempotency-key"]).toMatch(/^asset-studio:proposal:/);
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
    await page.getByRole("button", { name: "Review cost" }).click();

    await expect(page.getByRole("heading", { name: "Review before starting" })).toBeVisible();
    expect(proposalKind).toBe("image_create");
    expect(confirmationCount).toBe(0);

    await page.getByRole("button", { name: "Confirm and start" }).click();

    await expect(page).toHaveURL(
      new RegExp(`/create\\?projectId=${project.id}&runId=run_image$`),
    );
    await expect(page.getByText("queued", { exact: true })).toBeVisible();
    expect(confirmationCount).toBe(1);
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

    await page.getByRole("button", { name: "Review cost" }).click();
    await expect(
      page.getByRole("heading", { name: "Review before starting" }),
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

  test("does not surface a proposal after its project changes in flight", async ({
    page,
  }) => {
    const secondProject = {
      ...project,
      id: "project_social_cutdowns",
      name: "Social cutdowns",
    };
    let releaseProposal: (() => void) | undefined;
    const proposalReleased = new Promise<void>((resolve) => {
      releaseProposal = resolve;
    });
    let markProposalStarted: (() => void) | undefined;
    const proposalStarted = new Promise<void>((resolve) => {
      markProposalStarted = resolve;
    });

    await page.unroute("**/api/v1/projects?**");
    await page.route("**/api/v1/projects?**", (route) =>
      fulfillJson(route, {
        projects: [project, secondProject],
        pagination: { limit: 100, nextCursor: null },
      }),
    );
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/proposals`,
      async (route) => {
        markProposalStarted?.();
        await proposalReleased;
        await fulfillJson(
          route,
          {
            proposal: {
              sessionId: "session_stale",
              runId: "run_stale",
              gateId: "gate_stale",
              requestDigest: "digest_stale",
              maximumUsd: 10,
              approvalToken: "approval_stale",
              expiresAt: "2026-07-29T18:00:00.000Z",
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
      .fill("A precise campaign still");
    await page.getByRole("button", { name: "Review cost" }).click();
    await proposalStarted;

    await openProjectPicker(page);
    await page
      .getByRole("button", { name: secondProject.name, exact: true })
      .click();
    releaseProposal?.();

    await expect(page.getByRole("button", { name: "Review cost" })).toBeEnabled();
    await expect(
      page.getByRole("heading", { name: "Review before starting" }),
    ).toHaveCount(0);
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
