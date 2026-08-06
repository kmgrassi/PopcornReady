import { expect, test, type Page, type Route } from "@playwright/test";
import { mockLocalApi, now, workspaceId } from "./fixtures/local-api";

const project = {
  id: "creation-entry-project",
  schemaVersion: "project.v1",
  workspaceId,
  name: "Launch assets",
  status: "active",
  visibility: "private",
  createdAt: now,
  updatedAt: now,
};

async function json(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockProjects(page: Page, projects: unknown[]) {
  await page.unroute("**/api/v1/projects?**");
  await page.route("**/api/v1/projects?**", (route) =>
    json(route, {
      projects,
      pagination: { limit: 24, nextCursor: null },
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await mockLocalApi(page);
});

test("Dashboard, Activity, and the desktop shell share the Create launcher", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Create your first video or asset" })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.getByRole("heading", { name: "What do you want to make?" })).toBeVisible();

  await page.goto("/activity");
  await expect(page.getByRole("heading", { name: "No active generations" })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.getByRole("heading", { name: "What do you want to make?" })).toBeVisible();

  await page.goto("/dashboard");
  const desktopCreate = page
    .getByRole("complementary")
    .getByRole("link", { name: "Create", exact: true });
  await expect(desktopCreate).not.toHaveAttribute("aria-current", "page");
  await desktopCreate.click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(desktopCreate).toHaveAttribute("aria-current", "page");

  await page.goto("/create/asset");
  await expect(desktopCreate).toHaveAttribute("aria-current", "page");
  await page.goto("/create/review");
  await expect(desktopCreate).toHaveAttribute("aria-current", "page");
  await page.goto("/projects/new");
  await expect(desktopCreate).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("complementary").getByRole("link", { name: "Library", exact: true }),
  ).not.toHaveAttribute("aria-current", "page");
});

test("Library routes both nonempty and empty project actions to Create", async ({ page }) => {
  await mockProjects(page, [project]);
  await page.goto("/library/projects");
  const populatedCreate = page.getByRole("main").getByRole("link", {
    name: "Create",
    exact: true,
  });
  await expect(populatedCreate).toHaveCount(1);
  await populatedCreate.click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.getByRole("heading", { name: "What do you want to make?" })).toBeVisible();

  await mockProjects(page, []);
  await page.goto("/library/projects");
  const emptyCreate = page.getByRole("main").getByRole("link", {
    name: "Create",
    exact: true,
  });
  await expect(emptyCreate).toHaveCount(2);
  await emptyCreate.last().click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.getByRole("heading", { name: "What do you want to make?" })).toBeVisible();
});

test("launcher routes both intents and preserves legacy asset status links", async ({ page }) => {
  await page.goto("/create");

  const fullVideo = page.getByRole("link", { name: "Start a full video" });
  const projectAsset = page.getByRole("link", { name: "Create an asset or script" });
  await expect(fullVideo).toHaveAttribute("href", "/projects/new");
  await expect(projectAsset).toHaveAttribute("href", "/create/asset");
  await expect(page.getByRole("heading", { name: "Asset or script" })).toBeVisible();
  await expect(page.getByText(/start a text-first script/i)).toBeVisible();

  const actionColors = await page.evaluate(() => {
    const ctaProbe = document.createElement("span");
    ctaProbe.style.backgroundColor = "var(--cta)";
    document.body.append(ctaProbe);
    const fullVideoAction = Array.from(document.querySelectorAll("a")).find(
      (element) => element.textContent?.trim() === "Start a full video",
    );
    const assetAction = Array.from(document.querySelectorAll("a")).find(
      (element) => element.textContent?.trim() === "Create an asset or script",
    );
    const colors = {
      cta: getComputedStyle(ctaProbe).backgroundColor,
      fullVideo: fullVideoAction ? getComputedStyle(fullVideoAction).backgroundColor : "",
      asset: assetAction ? getComputedStyle(assetAction).backgroundColor : "",
    };
    ctaProbe.remove();
    return colors;
  });
  expect(actionColors.fullVideo).toBe(actionColors.cta);
  expect(actionColors.asset).not.toBe(actionColors.cta);

  await fullVideo.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/projects\/new$/);

  await page.goto("/create");
  await projectAsset.click();
  await expect(page).toHaveURL(/\/create\/asset$/);

  await page.goto(`/create?projectId=${project.id}&runId=legacy-run`);
  await expect(page).toHaveURL(
    new RegExp(`/create/asset\\?projectId=${project.id}&runId=legacy-run$`),
  );

  await mockProjects(page, [project]);
  await page.goto("/create");
  await page.evaluate(
    ({ projectId }) => {
      window.history.replaceState(
        {
          ...window.history.state,
          usr: {
            assetCreationDraft: {
              goal: "video",
              projectId,
              prompt: "A restored legacy draft",
              improvePrompt: false,
            },
          },
        },
        "",
        "/create",
      );
      window.location.reload();
    },
    { projectId: project.id },
  );
  await expect(page).toHaveURL(/\/create\/asset$/);
  await expect(
    page.getByRole("radio", { name: "Video A short motion asset" }),
  ).toBeChecked();
  await expect(page.getByLabel("Describe the result")).toHaveValue(
    "A restored legacy draft",
  );
  await expect(page.getByLabel("Improve video prompt")).not.toBeChecked();
});

test("Create hands script intent to a new Creative Director brief without starting work", async ({ page }) => {
  await mockProjects(page, [project]);
  const productionWrites: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      (request.url().includes("/agent-creations") ||
        request.url().includes("/generation-entrypoints/") ||
        request.url().includes("/generation-runs") ||
        /\/api\/v1\/projects(?:\?|$)/.test(request.url()))
    ) {
      productionWrites.push(request.url());
    }
  });
  await page.route(
    /\/api\/v1\/workspaces\/[^/]+\/studio-drafts(?:\?.*)?$/,
    async (route) => {
      if (route.request().method() !== "POST") {
        await json(route, { drafts: [], pagination: { limit: 20, nextCursor: null } });
        return;
      }
      const body = await route.request().postDataJSON();
      await json(route, {
        draft: {
          id: "script-entry-draft",
          schemaVersion: "studioDraft.v1",
          workspaceId,
          displayExcerpt: body.payload.draft.goal,
          step: body.payload.step,
          createdAt: now,
          updatedAt: now,
          payload: body.payload,
        },
      });
    },
  );

  await page.goto("/create");
  await expect(page.getByText(/start a text-first script/i)).toBeVisible();
  await page.getByRole("link", { name: "Create an asset or script" }).click();
  await expect(page.getByRole("navigation", { name: "Recent projects" })).toBeVisible();

  await page.getByText("Script", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Create a script" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Recent projects" })).toHaveCount(0);
  await expect(page.getByText("Script project", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Project Choose a project/ })).toHaveCount(0);
  await expect(page.getByText(/stops at script review/i)).toBeVisible();

  await page.getByText("Image", { exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Recent projects" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Review request" })).toBeVisible();
  await page.getByLabel("Describe the result").fill("A preserved image request");

  await page.getByText("Script", { exact: true }).click();
  await page.getByRole("textbox", { name: /Describe the script/ }).fill(
    "  A warm thirty-second founder story about creative momentum  ",
  );
  await page.getByText("Image", { exact: true }).click();
  await expect(page.getByLabel("Describe the result")).toHaveValue(
    "A preserved image request",
  );
  await page.getByText("Script", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: /Describe the script/ })).toHaveValue(
    "  A warm thirty-second founder story about creative momentum  ",
  );
  await page.getByRole("button", { name: "Continue to script brief" }).click();

  await expect(page).toHaveURL(/\/projects\/new\?draft=script-entry-draft/);
  expect(page.url()).not.toContain("founder");
  await expect(
    page.getByRole("radio", { name: "An idea We’ll write the script", exact: true }),
  ).toBeChecked();
  await expect(page.getByLabel("Video idea")).toHaveValue(
    "A warm thirty-second founder story about creative momentum",
  );
  await expect(page.getByRole("radio", { name: "30s Ad", exact: true })).toBeChecked();
  expect(productionWrites).toEqual([]);
});

test("Script handoff keeps its prefill when Studio draft persistence is unavailable", async ({ page }) => {
  await page.route(
    /\/api\/v1\/workspaces\/[^/]+\/studio-drafts(?:\?.*)?$/,
    async (route) => {
      if (route.request().method() === "POST") {
        await json(route, { error: { message: "Draft persistence unavailable" } }, 500);
        return;
      }
      await json(route, { drafts: [], pagination: { limit: 20, nextCursor: null } });
    },
  );
  await page.goto("/create/asset");
  await page.getByText("Script", { exact: true }).click();
  await page.getByRole("textbox", { name: /Describe the script/ }).fill(
    "A resilient script handoff",
  );
  await page.getByRole("button", { name: "Continue to script brief" }).click();

  await expect(page).toHaveURL(/\/projects\/new\?start=1/);
  await expect(page.getByLabel("Video idea")).toHaveValue(
    "A resilient script handoff",
  );
});

test("leaving Studio cancels a pending Script handoff navigation", async ({ page }) => {
  let releaseDraftRequest = () => {};
  let markDraftStarted = () => {};
  const draftRequestRelease = new Promise<void>((resolve) => {
    releaseDraftRequest = resolve;
  });
  const draftStarted = new Promise<void>((resolve) => {
    markDraftStarted = resolve;
  });

  await page.route(
    /\/api\/v1\/workspaces\/[^/]+\/studio-drafts(?:\?.*)?$/,
    async (route) => {
      if (route.request().method() !== "POST") {
        await json(route, { drafts: [], pagination: { limit: 20, nextCursor: null } });
        return;
      }
      const body = await route.request().postDataJSON();
      markDraftStarted();
      await draftRequestRelease;
      await json(route, {
        draft: {
          id: "late-script-draft",
          schemaVersion: "studioDraft.v1",
          workspaceId,
          displayExcerpt: body.payload.draft.goal,
          step: body.payload.step,
          createdAt: now,
          updatedAt: now,
          payload: body.payload,
        },
      });
    },
  );

  await page.goto("/create/asset");
  await page.getByText("Script", { exact: true }).click();
  await page.getByRole("textbox", { name: /Describe the script/ }).fill(
    "A script handoff the creator decides to leave",
  );
  await page.getByRole("button", { name: "Continue to script brief" }).click();
  await draftStarted;

  await page.goBack();
  await expect(page).toHaveURL(/\/create\/asset$/);
  const persistedResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/api\/v1\/workspaces\/[^/]+\/studio-drafts(?:\?.*)?$/.test(response.url()),
  );
  releaseDraftRequest();
  await persistedResponse;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await expect(page).toHaveURL(/\/create\/asset$/);
});

test("four Create choices remain keyboard-reachable without mobile overflow @mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/create/asset");

  const choices = page.getByRole("radio");
  await expect(choices).toHaveCount(4);
  await choices.first().focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(choices.last()).toBeChecked();
  await expect(page.getByRole("button", { name: "Continue to script brief" })).toBeDisabled();

  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBe(overflow.clientWidth);
});

test("full-video intake starts from either an idea or a script @mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/projects/new");
  const firstVideo = page.getByRole("button", { name: "Create your first video" });
  if (await firstVideo.isVisible()) await firstVideo.click();

  await expect(page.getByRole("radio", { name: "An idea We’ll write the script", exact: true })).toBeChecked();
  await page.getByLabel("Video idea").fill("A tiny mystery in a popcorn shop");
  await expect(page.getByRole("button", { name: "Continue →" })).toBeEnabled();

  await page.getByText("A script", { exact: true }).click();
  await expect(page.getByRole("radio", { name: "A script Use your words as the draft", exact: true })).toBeChecked();
  const script = page.getByRole("textbox", { name: /Script Paste narration/ });
  await expect(script).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue →" })).toBeDisabled();
  await script.fill("OPEN ON: An empty counter.\n\nMAYA: The last kernel is missing.");
  await expect(page.getByRole("button", { name: "Continue →" })).toBeEnabled();
  await expect(page.getByText(/text-only until you approve it/i)).toBeVisible();

  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBe(overflow.clientWidth);
});

test("mobile Create stays active across both creation flows without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");

  const mobileNav = page.getByRole("navigation", { name: "Primary mobile" });
  const create = mobileNav.getByRole("link", { name: "Create", exact: true });
  await create.click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(create).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "What do you want to make?" })).toBeVisible();

  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBe(overflow.clientWidth);

  const createStyle = await create.evaluate((element) => {
    const ctaProbe = document.createElement("span");
    ctaProbe.style.backgroundColor = "var(--cta)";
    document.body.append(ctaProbe);
    const styles = {
      background: getComputedStyle(element).backgroundColor,
      cta: getComputedStyle(ctaProbe).backgroundColor,
    };
    ctaProbe.remove();
    return styles;
  });
  expect(createStyle.background).not.toBe(createStyle.cta);

  await page.getByRole("link", { name: "Create an asset or script" }).click();
  await expect(page).toHaveURL(/\/create\/asset$/);
  await expect(create).toHaveAttribute("aria-current", "page");

  await page.goto("/create/review");
  await expect(create).toHaveAttribute("aria-current", "page");

  await page.goto("/projects/new");
  await expect(page).toHaveURL(/\/projects\/new$/);
  await expect(create).toHaveAttribute("aria-current", "page");
  await expect(
    mobileNav.getByRole("link", { name: "Library", exact: true }),
  ).not.toHaveAttribute("aria-current", "page");

  await page.goto(`/projects/${project.id}`);
  await expect(create).not.toHaveAttribute("aria-current", "page");
  await expect(
    mobileNav.getByRole("link", { name: "Library", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("a restored Studio generation shows the Creative Director hierarchy @mobile", async ({ page }) => {
  const draftId = "draft-hierarchy";
  const runId = "run-hierarchy";

  await page.route(`**/api/v1/workspaces/*/studio-drafts/${draftId}`, async (route) => {
    const requestPayload = route.request().method() === "PUT"
      ? (await route.request().postDataJSON()).payload
      : {
          v: 1,
          step: "generate",
          projectId: project.id,
          runId,
          draft: {
            goal: "Make a launch video",
            projectName: project.name,
            targetLengthSec: 30,
            aspectRatio: "9:16",
          },
        };
    await json(route, {
      draft: {
        draftId,
        step: "generate",
        updatedAt: now,
        projectId: project.id,
        runId,
        payload: requestPayload,
      },
    });
  });
  await page.route(
    `**/api/v1/projects/${project.id}/generation-runs/${runId}`,
    (route) => json(route, studioRunDetail(project.id, runId)),
  );

  await page.goto(`/projects/new?draft=${draftId}`);

  await expect(page.getByRole("heading", { name: "Creative Director" })).toBeVisible();
  await expect(page.getByText("Visuals", { exact: true })).toBeVisible();
  await expect(page.getByText("Audio", { exact: true })).toBeVisible();
  await expect(page.getByText("Building the plan", { exact: true })).toHaveCount(0);
});

function studioRunDetail(projectId: string, runId: string) {
  return {
    run: {
      runId,
      projectId,
      status: "running",
      currentStageType: "asset_generation",
      progressPercent: 50,
      message: "Specialists are producing the approved plan.",
      reviewGate: null,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
    },
    stages: [],
    stageItems: [],
    resultArtifacts: [],
    hierarchy: {
      root: {
        runId,
        state: "active",
        message: "The creative director is guiding this production.",
        needsDirectorDecision: false,
      },
      sessions: [
        {
          sessionId: "visual-session",
          domain: "visuals",
          state: "active",
          runs: [{
            runId: "visual-run",
            state: "active",
            taskKind: "visual_production",
            report: null,
            actions: [],
          }],
        },
        {
          sessionId: "audio-session",
          domain: "audio",
          state: "queued",
          runs: [{
            runId: "audio-run",
            state: "queued",
            taskKind: "audio_production",
            report: null,
            actions: [],
          }],
        },
      ],
    },
  };
}
