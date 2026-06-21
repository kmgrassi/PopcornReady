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
