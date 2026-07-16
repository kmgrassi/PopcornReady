import { expect, test, type Page } from "@playwright/test";

const projectId = "project_storyboard_e2e";

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

async function mockProjectWorkspace(page: Page) {
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
          hasStoryboard: false,
          createdAt: "2026-06-16T00:00:00.000Z",
          updatedAt: "2026-06-16T00:00:00.000Z",
        },
      },
    });
  });

  await page.route(`**/api/v1/projects/${projectId}/storyboard`, async (route) => {
    await route.fulfill({ json: { storyboard: null } });
  });

  await page.route("**/api/v1/workspaces/workspace_storyboard_e2e/generation-runs**", async (route) => {
    await route.fulfill({
      json: {
        runs: [],
        pagination: { limit: 25, nextCursor: null },
      },
    });
  });

  await page.route("**/api/v1/workspaces/workspace_storyboard_e2e/outputs**", async (route) => {
    await route.fulfill({
      json: {
        outputs: [],
        pagination: { limit: 6, nextCursor: null },
      },
    });
  });
}

test("project storyboard route renders the dedicated storyboard page", async ({ page }) => {
  await mockLocalAuth(page);
  await mockProjectWorkspace(page);

  await page.goto(`/projects/${projectId}/storyboard`);

  // It no longer redirects — it renders the storyboard page (empty state here,
  // since the mocked project has no storyboard).
  await expect(page).toHaveURL(`/projects/${projectId}/storyboard`);
  await expect(page.getByRole("heading", { name: "Storyboard", exact: true })).toBeVisible();
  await expect(page.getByText("No storyboard yet")).toBeVisible();
});

test("reviewed storyboard offers the explicit video-production continuation", async ({ page }) => {
  await mockLocalAuth(page);
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
          hasStoryboard: true,
          createdAt: "2026-06-16T00:00:00.000Z",
          updatedAt: "2026-06-16T00:00:00.000Z",
        },
      },
    });
  });
  await page.route(`**/api/v1/projects/${projectId}/storyboard`, async (route) => {
    await route.fulfill({
      json: {
        storyboard: {
          id: "storyboard_1",
          projectId,
          planAssetId: "plan_1",
          status: "ready",
          createdAt: "2026-06-16T00:00:00.000Z",
          updatedAt: "2026-06-16T00:00:00.000Z",
          scenes: [
            {
              id: "scene_1",
              projectId,
              storyboardId: "storyboard_1",
              sceneIndex: 0,
              title: "Opening",
              summary: "A quiet greenhouse drifts above Earth.",
              setting: "Orbital greenhouse",
              mood: "Luminous and calm",
              durationSec: 12,
              sceneAssetId: null,
              status: "ready",
              createdAt: "2026-06-16T00:00:00.000Z",
              updatedAt: "2026-06-16T00:00:00.000Z",
              beats: [
                {
                  id: "beat_1",
                  projectId,
                  sceneId: "scene_1",
                  beatIndex: 0,
                  intent: "Leaves float in zero gravity.",
                  visualDescription: null,
                  dialogueSummary: null,
                  narration: null,
                  durationSec: 4,
                  shotType: null,
                  camera: null,
                  framing: null,
                  status: "ready",
                  beatAssetId: null,
                  createdAt: "2026-06-16T00:00:00.000Z",
                  updatedAt: "2026-06-16T00:00:00.000Z",
                  panels: [
                    {
                      id: "panel_1",
                      projectId,
                      beatId: "beat_1",
                      panelIndex: 0,
                      imageAssetId: "tile_1",
                      status: "ready",
                      isSelected: true,
                      approvedAt: null,
                      createdAt: "2026-06-16T00:00:00.000Z",
                      updatedAt: "2026-06-16T00:00:00.000Z",
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    });
  });
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
              stageId: "run_storyboard:tool:after:generate_storyboard",
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
  await expect(page.getByRole("button", { name: "Generate video" })).toBeVisible();
  await page.getByRole("button", { name: "Generate video" }).click();
  await expect.poll(() => continued).toBe(true);
});
