import { expect, test, type Route } from "@playwright/test";
import { mockLocalApi, now, workspaceId } from "./fixtures/local-api";

async function reply(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test.beforeEach(async ({ page }) => {
  await mockLocalApi(page);
});

test("Script uses a dedicated text-only creation flow", async ({ page }) => {
  const writes: Array<{ url: string; body: Record<string, unknown> }> = [];
  await page.route("**/api/v1/projects", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    writes.push({ url: route.request().url(), body: await route.request().postDataJSON() });
    await reply(route, {
      project: {
        id: "script-project",
        schemaVersion: "project.v1",
        workspaceId,
        name: "After abundance",
        status: "active",
        visibility: "private",
        createdAt: now,
        updatedAt: now,
      },
      briefVersion: { id: "script-brief", projectId: "script-project", createdAt: now },
    }, 201);
  });
  await page.route("**/api/v1/projects/script-project/generation-entrypoints/script", async (route) => {
    writes.push({ url: route.request().url(), body: await route.request().postDataJSON() });
    await reply(route, { runId: "script-run" }, 202);
  });

  await page.goto("/create");
  await page.getByRole("link", { name: "Start a script" }).click();
  await expect(page).toHaveURL(/\/create\/script$/);
  await expect(page.getByRole("heading", { name: "Create a script" })).toBeVisible();
  await expect(page.getByText(/Story idea.*Story outline.*Script/)).toBeVisible();
  await expect(page.getByText(/No footage or media will be generated/i)).toBeVisible();
  await expect(page.getByText(/could cost a lot/i)).toHaveCount(0);
  await expect(page.getByText(/source footage/i)).toHaveCount(0);
  await expect(page.getByText(/production plan/i)).toHaveCount(0);

  await page.getByLabel("What is the story?").fill(
    "A teenager on a post-abundance planet discovers what their grandparents endured before AI.",
  );
  await page.getByRole("radio", { name: /5 minutes/ }).check();
  await page.getByRole("button", { name: "Develop story" }).click();

  await expect(page).toHaveURL(/\/projects\/script-project\/runs\/script-run$/);
  expect(writes).toHaveLength(2);
  expect(writes[0]?.body).toMatchObject({ namingContext: "script" });
  expect((writes[0]?.body.brief as { targetLengthSec?: number }).targetLengthSec).toBe(300);
  expect(writes[1]?.body).toEqual({ briefVersionId: "script-brief" });
});

test("Script intake stays contained on mobile @mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/create/script");
  await expect(page.getByRole("heading", { name: "Create a script" })).toBeVisible();
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBe(overflow.clientWidth);
});

test("Script review revises writing, finishes without media, and stays reopenable", async ({ page }) => {
  const projectId = "script-review-project";
  const runId = "script-review-run";
  let revision = 1;
  let finished = false;
  const writes: Array<{ path: string; body: unknown }> = [];
  const mediaWrites: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const path = new URL(request.url()).pathname;
    if (/poster|storyboard|image|audio|video|delegate|dispatch/.test(path)) mediaWrites.push(path);
  });

  const reviewDetail = () => ({
    run: {
      runId,
      projectId,
      status: "succeeded",
      presentationKind: "script_creation",
      completionKind: finished ? "script" : undefined,
      currentStageType: finished ? "ready" : "script",
      progressPercent: finished ? 100 : 70,
      message: finished ? "Your script is ready." : "Script is ready for review.",
      reviewGate: finished ? null : {
        stageId: "script-review-stage",
        stageType: "script",
        state: "awaiting_review",
        enteredAt: now,
      },
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      completedAt: now,
    },
    stages: [],
    stageItems: [],
  });

  await page.route(`**/api/v1/projects/${projectId}`, (route) => reply(route, {
    project: {
      id: projectId,
      schemaVersion: "project.v1",
      workspaceId,
      name: "After abundance",
      status: "active",
      visibility: "private",
      brief: { goal: "A teenager studies life before abundance.", targetLengthSec: 300, aspectRatio: "16:9" },
      createdAt: now,
      updatedAt: now,
    },
  }));
  await page.route(`**/api/v1/projects/${projectId}/story-blueprint`, (route) => reply(route, {
    storyBlueprint: {
      storyBlueprintId: `blueprint-${revision}`,
      assetId: `blueprint-asset-${revision}`,
      contentHash: `blueprint-hash-${revision}`,
      storyBlueprint: {
        schemaVersion: "storyBlueprint.v1",
        premise: "A comfortable teenager confronts inherited sacrifice.",
        logline: revision === 1 ? "An archive challenges paradise." : "A grandmother's archive challenges paradise.",
        tone: "hopeful science fiction",
        targetLengthSec: 300,
        aspectRatio: "16:9",
        scenes: [{ id: "plot-1", title: "The archive", summary: revision === 1 ? "Mara finds old records." : "Mara and her grandmother open the records together.", actId: "act-1" }],
        ending: revision === 1 ? "Mara understands the past." : "Mara preserves her grandmother's story.",
      },
    },
  }));
  await page.route(`**/api/v1/projects/${projectId}/script`, (route) => reply(route, {
    script: {
      scriptDraftId: `script-${revision}`,
      assetId: `script-asset-${revision}`,
      contentHash: `script-hash-${revision}`,
      scriptDraft: {
        schemaVersion: "scriptDraft.v1",
        id: `script-${revision}`,
        projectId,
        briefAssetId: "brief-1",
        storyBlueprintId: `blueprint-${revision}`,
        targetLengthSec: 300,
        durationClass: "medium",
        durationPlan: { targetLengthSec: 300, durationClass: "medium", expectedActCount: 3, expectedSceneCount: 8, expectedBeatCount: 38, planningGranularity: "acts_scenes_beats" },
        scenes: [{ id: "scene-1", title: "The archive", summary: "Mara opens the archive.", narration: revision === 1 ? "The room remembered." : "Her grandmother let the room remember.", dialogue: [], durationSec: 60 }],
        narration: revision === 1 ? "An opening voiceover frames the inherited mystery." : "An opening voiceover frames the grandmother's legacy.",
        status: "draft",
        createdAt: now,
        updatedAt: now,
      },
    },
  }));
  await page.route(`**/api/v1/projects/${projectId}/generation-runs/${runId}`, (route) => reply(route, reviewDetail()));
  await page.route(`**/api/v1/projects/${projectId}/generation-runs/${runId}/reject`, async (route) => {
    writes.push({ path: "reject", body: await route.request().postDataJSON() });
    revision = 2;
    await reply(route, reviewDetail(), 202);
  });
  await page.route(`**/api/v1/projects/${projectId}/generation-runs/${runId}/approve`, async (route) => {
    writes.push({ path: "approve", body: await route.request().postDataJSON() });
    finished = true;
    await reply(route, reviewDetail(), 202);
  });

  await page.goto(`/projects/${projectId}/runs/${runId}`);
  await expect(page.getByRole("heading", { name: "Script ready for review" })).toBeVisible();
  await expect(page.getByRole("article", { name: "Story outline" })).toContainText("An archive challenges paradise.");
  await expect(page.getByText("An opening voiceover frames the inherited mystery.", { exact: true })).toBeVisible();
  await page.getByLabel("Feedback").fill("Make the grandmother central to the plot point and ending.");
  await page.getByRole("button", { name: "Request changes" }).click();
  await expect(page.getByRole("article", { name: "Story outline" })).toContainText("A grandmother's archive challenges paradise.");
  await expect(page.getByText("Her grandmother let the room remember.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Finish script" }).click();
  await expect(page.getByText("Your script is ready", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open script" })).toHaveAttribute("href", `/projects/${projectId}`);
  await page.reload();
  await expect(page.getByText("Your script is ready", { exact: true })).toBeVisible();
  expect(writes).toEqual([
    { path: "reject", body: { note: "Make the grandmother central to the plot point and ending.", scriptDraftId: "script-1" } },
    { path: "approve", body: { scriptDraftId: "script-2" } },
  ]);
  expect(mediaWrites).toEqual([]);
});

test("Script review fails closed when the outline cannot load", async ({ page }) => {
  const projectId = "script-outline-error";
  const runId = "script-outline-error-run";
  await page.route(`**/api/v1/projects/${projectId}`, (route) => reply(route, { project: { id: projectId, schemaVersion: "project.v1", workspaceId, name: "Outline error", status: "active", visibility: "private", createdAt: now, updatedAt: now } }));
  await page.route(`**/api/v1/projects/${projectId}/story-blueprint`, (route) => reply(route, { error: { message: "Outline unavailable" } }, 500));
  await page.route(`**/api/v1/projects/${projectId}/script`, (route) => reply(route, { script: { scriptDraftId: "script-1", assetId: "asset-1", contentHash: "hash-1", scriptDraft: { schemaVersion: "scriptDraft.v1", id: "script-1", projectId, briefAssetId: "brief-1", storyBlueprintId: "blueprint-1", targetLengthSec: 60, durationClass: "short", durationPlan: { targetLengthSec: 60 }, scenes: [{ id: "scene-1", title: "Scene", summary: "Summary", dialogue: [] }], status: "draft", createdAt: now, updatedAt: now } } }));
  await page.route(`**/api/v1/projects/${projectId}/generation-runs/${runId}`, (route) => reply(route, { run: { runId, projectId, status: "succeeded", presentationKind: "script_creation", currentStageType: "script", reviewGate: { stageId: "review", stageType: "script", state: "awaiting_review", enteredAt: now }, createdAt: now, updatedAt: now }, stages: [], stageItems: [] }));

  await page.goto(`/projects/${projectId}/runs/${runId}`);
  await expect(page.getByRole("alert").filter({ hasText: "Could not load the complete outline and script" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish script" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Request changes" })).toBeDisabled();

  await page.unroute(`**/api/v1/projects/${projectId}/story-blueprint`);
  await page.route(`**/api/v1/projects/${projectId}/story-blueprint`, (route) => reply(route, {
    storyBlueprint: {
      storyBlueprintId: "blueprint-new",
      assetId: "blueprint-new-asset",
      contentHash: "blueprint-new-hash",
      storyBlueprint: {
        schemaVersion: "storyBlueprint.v1",
        premise: "A changed outline.",
        logline: "The outline changed after this script was written.",
        targetLengthSec: 60,
        aspectRatio: "16:9",
        scenes: [{ id: "plot-1", title: "Changed", summary: "Changed plot.", actId: "act-1" }],
        ending: "A changed ending.",
      },
    },
  }));
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "older story outline" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish script" })).toBeDisabled();
});
