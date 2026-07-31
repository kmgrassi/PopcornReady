import { expect, test, type Page } from "@playwright/test";

const projectId = "project_storyboard_e2e";
const imageDataUrl =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 450'%3E%3Crect width='800' height='450' fill='%2314111c'/%3E%3Ccircle cx='400' cy='225' r='150' fill='%235fd39a'/%3E%3C/svg%3E";

async function mockLocalAuth(page: Page) {
  await page.route("**/api/v1/me", async (route) => {
    await route.fulfill({
      json: {
        actor: { id: "local-user", type: "local", email: "local@example.test" },
        workspaceId: "workspace_storyboard_e2e",
        workspaceName: "E2E Workspace",
        authMode: "local",
        isLocal: true,
      },
    });
  });
}

async function mockProject(page: Page, hasStoryboard = false) {
  await page.route(`**/api/v1/projects/${projectId}`, async (route) => {
    await route.fulfill({
      json: {
        project: {
          id: projectId,
          schemaVersion: "project.v1",
          workspaceId: "workspace_storyboard_e2e",
          name: "Storyboard project",
          status: "active",
          visibility: "private",
          hasStoryboard,
          createdAt: "2026-06-16T00:00:00.000Z",
          updatedAt: "2026-06-16T00:00:00.000Z",
        },
      },
    });
  });
}

async function mockProjectWorkspace(page: Page) {
  await mockProject(page);
  await page.route(`**/api/v1/projects/${projectId}/storyboard`, async (route) => {
    await route.fulfill({ json: { storyboard: null } });
  });
  await page.route("**/api/v1/workspaces/workspace_storyboard_e2e/generation-runs**", async (route) => {
    await route.fulfill({ json: { runs: [], pagination: { limit: 25, nextCursor: null } } });
  });
  await page.route("**/api/v1/workspaces/workspace_storyboard_e2e/outputs**", async (route) => {
    await route.fulfill({ json: { outputs: [], pagination: { limit: 6, nextCursor: null } } });
  });
}

function readyStoryboard() {
  return {
    id: "storyboard_e2e",
    projectId,
    planAssetId: "plan_e2e",
    status: "ready",
    scenes: [
      {
        id: "scene_e2e",
        projectId,
        storyboardId: "storyboard_e2e",
        sceneIndex: 0,
        title: "Orbital Greenhouse",
        summary: "A greenhouse rotates above the moon.",
        setting: null,
        mood: null,
        durationSec: 6,
        sceneAssetId: null,
        status: "ready",
        beats: [
          {
            id: "beat_e2e",
            projectId,
            sceneId: "scene_e2e",
            beatIndex: 0,
            intent: "Orbital Greenhouse — Quiet Hope",
            visualDescription: null,
            dialogueSummary: null,
            narration: null,
            durationSec: 6,
            shotType: null,
            camera: null,
            framing: null,
            status: "ready",
            beatAssetId: null,
            panels: [
              {
                id: "panel_e2e",
                projectId,
                beatId: "beat_e2e",
                panelIndex: 0,
                imageAssetId: "asset_e2e",
                promptAssetId: null,
                prompt: "A quiet orbital greenhouse glowing above the moon, cinematic still.",
                url: imageDataUrl,
                thumbnailUrl: imageDataUrl,
                status: "ready",
                isSelected: true,
                approvedAt: null,
                createdAt: "2026-06-16T00:00:00.000Z",
                updatedAt: "2026-06-16T00:00:00.000Z",
              },
            ],
            createdAt: "2026-06-16T00:00:00.000Z",
            updatedAt: "2026-06-16T00:00:00.000Z",
          },
        ],
        createdAt: "2026-06-16T00:00:00.000Z",
        updatedAt: "2026-06-16T00:00:00.000Z",
      },
    ],
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T00:00:00.000Z",
  };
}

async function mockReadyStoryboard(page: Page) {
  await mockProject(page, true);
  await page.route(`**/api/v1/projects/${projectId}/storyboard`, async (route) => {
    await route.fulfill({ json: { storyboard: readyStoryboard() } });
  });
}

test("project storyboard route renders the dedicated storyboard page", async ({ page }) => {
  await mockLocalAuth(page);
  await mockProjectWorkspace(page);

  await page.goto(`/projects/${projectId}/storyboard`);

  await expect(page).toHaveURL(`/projects/${projectId}/storyboard`);
  await expect(page.getByRole("heading", { name: "Storyboard", exact: true })).toBeVisible();
  await expect(page.getByText("No storyboard yet")).toBeVisible();
});

test("storyboard opens exact-target change requests from asset detail @mobile", async ({ page }) => {
  await mockLocalAuth(page);
  await mockReadyStoryboard(page);

  await page.goto(`/projects/${projectId}/storyboard`);

  await expect(page.getByText("Beat 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Orbital Greenhouse — Quiet Hope", { exact: true })).toBeVisible();
  await expect(page.getByText("Image prompt", { exact: true })).toHaveCount(0);
  await expect(page.getByText("A quiet orbital greenhouse glowing above the moon, cinematic still.")).toHaveCount(0);

  await page.getByRole("button", { name: "Orbital Greenhouse — Quiet Hope" }).click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Original prompt", { exact: true })).toBeVisible();
  await expect(
    page.getByText("A quiet orbital greenhouse glowing above the moon, cinematic still.")
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "What should change?" })).toHaveValue("");
});

test("reviewed storyboard offers the explicit video-production continuation", async ({ page }) => {
  await mockLocalAuth(page);
  await mockReadyStoryboard(page);
  await page.route(`**/api/v1/projects/${projectId}/generation-runs`, async (route) => {
    await route.fulfill({
      json: {
        runs: [
          {
            runId: "run_storyboard",
            projectId,
            status: "succeeded",
            completionKind: "storyboard_assets",
            currentStageType: "storyboard",
            progressPercent: 100,
            reviewGates: [],
            reviewGate: {
              stageType: "storyboard",
              stageId: "run_storyboard:tool:generate_storyboard",
              state: "awaiting_review",
              enteredAt: "2026-06-16T00:00:01.000Z",
            },
            message: "Storyboard assets are ready.",
            createdAt: "2026-06-16T00:00:00.000Z",
            updatedAt: "2026-06-16T00:00:01.000Z",
          },
        ],
      },
    });
  });
  let continued = false;
  await page.route(
    `**/api/v1/projects/${projectId}/generation-runs/run_storyboard/approve`,
    async (route) => {
      continued = true;
      await route.fulfill({
        json: {
          run: {
            runId: "run_storyboard",
            projectId,
            status: "waiting",
            reviewGates: [],
            reviewGate: null,
            createdAt: "2026-06-16T00:00:00.000Z",
            updatedAt: "2026-06-16T00:00:02.000Z",
          },
          stages: [],
          stageItems: [],
          resultArtifacts: [],
        },
      });
    },
  );

  await page.goto(`/projects/${projectId}/storyboard`);

  await expect(page.getByText("Storyboard ready for review")).toBeVisible();
  await page.getByRole("button", { name: "Generate video" }).click();
  await expect.poll(() => continued).toBe(true);
});
