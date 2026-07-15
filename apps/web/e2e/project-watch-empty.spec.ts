import { expect, test } from "@playwright/test";

test("direct watch route explains when no playable video exists", async ({ page }) => {
  await page.route("**/api/v1/me", (route) =>
    route.fulfill({
      json: {
        actor: { id: "dev-user", type: "local", email: "developer@popcornready.local" },
        workspaceId: "dev_workspace",
        workspaceName: "Development workspace",
        authMode: "local",
        isLocal: true,
      },
    }),
  );
  await page.route("**/api/v1/projects/project-no-video/watch", (route) =>
    route.fulfill({ json: { media: null } }),
  );

  await page.goto("/projects/project-no-video/watch");

  await expect(page).toHaveURL(/\/projects\/project-no-video\/watch$/);
  await expect(page.getByText("No playable video is available.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open workspace" })).toBeVisible();
});
