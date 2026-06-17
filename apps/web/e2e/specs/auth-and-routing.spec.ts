import { expect, test } from "@playwright/test";
import { expectNoAppCrash, mockLocalApi } from "../fixtures/local-api";

test("health endpoint returns JSON through the browser API path", async ({ page }) => {
  const response = await page.goto("/api/v1/health");
  expect(response?.ok()).toBe(true);
  expect(response?.headers()["content-type"]).toContain("application/json");

  const body = JSON.parse((await page.locator("body").textContent()) ?? "{}");
  expect(body).toMatchObject({ status: "ok", authMode: "local" });
});

test.describe("local auth and routing smoke", () => {
  test.beforeEach(async ({ page }) => {
    await mockLocalApi(page);
  });

  test("renders public auth routes", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Start creating" })).toBeVisible();

    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    await page.goto("/signup");
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
  });

  test("opens protected local-mode surfaces without a hosted session", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Workspace controls" })).toBeVisible();
    await expect(page.getByText("Local mode").first()).toBeVisible();

    await page.goto("/studio");
    await expect(page.getByRole("heading", { name: "Create your first AI rough cut" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create your first video" })).toBeVisible();

    await page.goto("/library/projects");
    await expect(page.getByRole("navigation", { name: "Library collections" })).toBeVisible();
  });

  test("shows saved studio drafts instead of the first-video prompt", async ({ page }) => {
    await page.route(/\/api\/v1\/workspaces\/[^/]+\/studio-drafts(?:\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          drafts: [
            {
              id: "draft-existing",
              schemaVersion: "studioDraft.v1",
              workspaceId: "e2e_local_workspace",
              displayExcerpt: "Launch teaser for the summer drop",
              step: "story",
              createdAt: "2026-06-16T00:00:00.000Z",
              updatedAt: "2026-06-16T12:00:00.000Z",
            },
          ],
          pagination: { limit: 20, nextCursor: null },
        }),
      }),
    );

    await page.goto("/studio");

    await expect(page.getByRole("heading", { name: "Continue a draft" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Launch teaser for the summer drop/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create your first video" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Create your first AI rough cut" })).toHaveCount(0);
  });

  test("does not create duplicate drafts from rapid first-video clicks", async ({ page }) => {
    let createRequests = 0;
    let releaseCreate: (() => void) | null = null;

    await page.route(/\/api\/v1\/workspaces\/[^/]+\/studio-drafts(?:\?.*)?$/, async (route) => {
      if (route.request().method() === "POST") {
        createRequests += 1;
        await new Promise<void>((resolve) => {
          releaseCreate = resolve;
        });
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            draft: {
              id: "draft-created",
              schemaVersion: "studioDraft.v1",
              workspaceId: "e2e_local_workspace",
              displayExcerpt: "Untitled draft",
              step: "brief",
              createdAt: "2026-06-16T00:00:00.000Z",
              updatedAt: "2026-06-16T12:00:00.000Z",
              payload: { v: 1, draft: { goal: "" }, step: "brief" },
            },
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ drafts: [], pagination: { limit: 20, nextCursor: null } }),
      });
    });

    await page.goto("/studio");

    const createButton = page.getByRole("button", { name: "Create your first video" });
    await expect(createButton).toBeVisible();

    await createButton.evaluate((element) => {
      element.click();
      element.click();
    });

    await expect.poll(() => createRequests).toBe(1);
    await expect(createButton).toBeDisabled();

    releaseCreate?.();
    await expect(page).toHaveURL(/\/studio\?draft=draft-created$/);
  });

  test("keeps compatibility redirects and not-found route working", async ({ page }) => {
    await page.goto("/projects?source=smoke");
    await expect(page).toHaveURL(/\/library\/projects\?source=smoke$/);
    await expectNoAppCrash(page);

    await page.goto("/runs?status=running");
    await expect(page).toHaveURL(/\/library\/runs\?status=running$/);
    await expectNoAppCrash(page);

    await page.goto("/assets");
    await expect(page).toHaveURL(/\/library\/assets$/);
    await expectNoAppCrash(page);

    await page.goto("/outputs");
    await expect(page).toHaveURL(/\/library\/outputs$/);
    await expectNoAppCrash(page);

    await page.goto("/library");
    await expect(page).toHaveURL(/\/library\/projects$/);
    await expectNoAppCrash(page);

    await page.goto("/route-that-does-not-exist");
    await expect(page.getByText("Not found is migrating from Next to Vite SPA.")).toBeVisible();
  });
});
