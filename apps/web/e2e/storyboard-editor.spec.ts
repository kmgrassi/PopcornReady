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
  await page.route("**/api/v1/workspaces/workspace_storyboard_e2e/generation-runs**", async (route) => {
    await route.fulfill({
      json: {
        runs: [],
        pagination: { limit: 25, nextCursor: null },
      },
    });
  });
}

test("legacy project storyboard route redirects to the project workspace", async ({ page }) => {
  await mockLocalAuth(page);
  await mockProjectWorkspace(page);

  await page.goto(`/projects/${projectId}/storyboard`);

  await expect(page).toHaveURL(`/library/runs?projectId=${projectId}`);
  await expect(page.getByRole("heading", { name: "Runs" })).toBeVisible();
  await expect(page.getByText("No runs match this filter")).toBeVisible();
});
