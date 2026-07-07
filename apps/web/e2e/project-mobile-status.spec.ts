import { expect, test, type Page } from "@playwright/test";

const projectId = "project-mobile-status-e2e";
const workspaceId = "workspace_mobile_status_e2e";
const now = "2026-06-16T00:00:00.000Z";
const imageDataUrl =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 1000'%3E%3Crect width='800' height='1000' fill='%2314111c'/%3E%3Ccircle cx='400' cy='360' r='180' fill='%23f5b62a'/%3E%3Crect x='180' y='620' width='440' height='90' rx='20' fill='%23ff7a4d'/%3E%3C/svg%3E";

test("mobile project overview renders one status-card job @mobile", async ({ page }) => {
  test.skip(!page.viewportSize() || page.viewportSize()!.width > 760, "Mobile-only composition.");

  await mockProjectOverview(page);

  await page.goto(`/projects/${projectId}`);

  const statusRegion = page.getByLabel("Project status");
  await expect(statusRegion.getByRole("heading", { name: "A faster lunch launch" })).toBeVisible();
  await expect(statusRegion.getByText("Ready to watch.")).toBeVisible();
  await expect(statusRegion.getByRole("link", { name: "Watch" })).toBeVisible();
  await expect(statusRegion.getByText("Storyboard", { exact: true })).toBeVisible();
  await expect(statusRegion.getByText("1 scene")).toBeVisible();
  await expect(statusRegion.getByText("Direction")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Project direction" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Stage and next step" })).toHaveCount(0);

  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(Math.max(overflow.body, overflow.document)).toBeLessThanOrEqual(
    overflow.viewport + 1,
  );
});

async function mockProjectOverview(page: Page) {
  await page.route("**/api/v1/me", async (route) => {
    await route.fulfill({
      json: {
        actor: { id: "local-user", type: "local", email: "local@example.test" },
        workspaceId,
        workspaceName: "E2E Workspace",
        authMode: "local",
        isLocal: true,
      },
    });
  });

  await page.route(`**/api/v1/projects/${projectId}`, async (route) => {
    await route.fulfill({
      json: {
        project: {
          id: projectId,
          schemaVersion: "project.v1",
          workspaceId,
          name: "Lunch launch",
          status: "active",
          visibility: "private",
          hasStoryboard: true,
          posterUrl: imageDataUrl,
          brief: {
            goal: "Make a product video for a lunch ordering app.",
            targetLengthSec: 30,
            aspectRatio: "9:16",
            platform: "tiktok",
            format: "short_social",
            audience: "office teams",
            oneBigIdea: "A faster lunch launch",
            hookQuestion: "What if lunch ordering took one tap?",
            strongestVisual: "A busy team gets lunch without leaving the meeting.",
          },
          createdAt: now,
          updatedAt: now,
        },
      },
    });
  });

  await page.route(`**/api/v1/projects/${projectId}/storyboard`, async (route) => {
    await route.fulfill({
      json: {
        storyboard: {
          id: "storyboard-mobile-status",
          projectId,
          planAssetId: null,
          status: "ready",
          scenes: [
            {
              id: "scene-mobile-status",
              projectId,
              storyboardId: "storyboard-mobile-status",
              sceneIndex: 0,
              title: "Lunch arrives",
              summary: "The team keeps working while lunch lands.",
              setting: null,
              mood: null,
              durationSec: 30,
              sceneAssetId: null,
              status: "ready",
              beats: [
                {
                  id: "beat-mobile-status",
                  projectId,
                  sceneId: "scene-mobile-status",
                  beatIndex: 0,
                  intent: "show_result",
                  visualDescription: "Lunch bags arrive at a conference table.",
                  dialogueSummary: null,
                  narration: "Lunch is handled.",
                  durationSec: 6,
                  shotType: null,
                  camera: null,
                  framing: null,
                  status: "ready",
                  beatAssetId: null,
                  panels: [
                    {
                      id: "panel-mobile-status",
                      projectId,
                      beatId: "beat-mobile-status",
                      panelIndex: 0,
                      imageAssetId: "asset-mobile-status",
                      promptAssetId: null,
                      prompt: "Lunch bags arrive at a conference table.",
                      url: imageDataUrl,
                      thumbnailUrl: imageDataUrl,
                      status: "ready",
                      isSelected: true,
                      approvedAt: null,
                      createdAt: now,
                      updatedAt: now,
                    },
                  ],
                  createdAt: now,
                  updatedAt: now,
                },
              ],
              createdAt: now,
              updatedAt: now,
            },
          ],
          createdAt: now,
          updatedAt: now,
        },
      },
    });
  });

  await page.route(`**/api/v1/projects/${projectId}/storyboards/generate`, async (route) => {
    await route.fulfill({ json: { job: null } });
  });

  await page.route(`**/api/v1/workspaces/${workspaceId}/generation-runs**`, async (route) => {
    await route.fulfill({
      json: {
        runs: [],
        pagination: { limit: 6, nextCursor: null },
      },
    });
  });

  await page.route(`**/api/v1/workspaces/${workspaceId}/outputs**`, async (route) => {
    await route.fulfill({
      json: {
        outputs: [
          {
            id: "output-mobile-status",
            projectId,
            title: "Lunch launch final",
            kind: "video",
            status: "ready",
            url: "/media/lunch-launch.mp4",
            playbackUrl: "/media/lunch-launch.mp4",
            thumbnailUrl: imageDataUrl,
            createdAt: now,
            updatedAt: now,
          },
        ],
        pagination: { limit: 6, nextCursor: null },
      },
    });
  });
}
