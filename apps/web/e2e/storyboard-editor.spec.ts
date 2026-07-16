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

test("storyboard keeps prompts in the asset detail @mobile", async ({ page }) => {
  await mockLocalAuth(page);
  await mockProjectWorkspace(page);

  await page.unroute(`**/api/v1/projects/${projectId}/storyboard`);
  await page.route(`**/api/v1/projects/${projectId}/storyboard`, async (route) => {
    await route.fulfill({
      json: {
        storyboard: {
          id: "storyboard_e2e",
          projectId,
          planAssetId: null,
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
        },
      },
    });
  });

  await page.goto(`/projects/${projectId}/storyboard`);

  await expect(page.getByText("Beat 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Orbital Greenhouse — Quiet Hope", { exact: true })).toBeVisible();
  await expect(page.getByText("Image prompt", { exact: true })).toHaveCount(0);
  await expect(page.getByText("A quiet orbital greenhouse glowing above the moon, cinematic still.")).toHaveCount(0);

  await page.getByRole("button", { name: "Orbital Greenhouse — Quiet Hope" }).click();

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Generation prompt", { exact: true })).toBeVisible();
  await expect(page.getByText("A quiet orbital greenhouse glowing above the moon, cinematic still.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "What should change?" })).toHaveValue("");
});
