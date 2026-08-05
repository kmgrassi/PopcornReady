import { expect, test, type Route } from "@playwright/test";
import {
  expectNoAppCrash,
  mockLocalApi,
  now,
  workspaceId,
} from "../fixtures/local-api";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fulfillJson(route: Route, body: unknown) {
  const origin = route.request().headers().origin;
  await route.fulfill({
    status: 200,
    headers: {
      "access-control-allow-credentials": "true",
      "access-control-allow-origin": origin ?? "*",
      "content-type": "application/json",
      vary: "origin",
    },
    body: JSON.stringify(body),
  });
}

test("health endpoint returns JSON through the browser API path", async ({ page }) => {
  const response = await page.goto("/api/v1/health");
  expect(response?.ok()).toBe(true);
  expect(response?.headers()["content-type"]).toContain("application/json");
  expect(response?.headers()["cache-control"]).toContain("no-store");

  const body = JSON.parse((await page.locator("body").textContent()) ?? "{}");
  expect(body).toMatchObject({
    status: "ok",
    authMode: "local",
    release: { ready: true },
  });
});

test.describe("local auth and routing smoke", () => {
  test.beforeEach(async ({ page }) => {
    await mockLocalApi(page);
  });

  test("renders public auth routes @mobile", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("textbox", { name: "What should the video be about?" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create my 30-second video" }),
    ).toBeVisible();

    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    await page.goto("/signup");
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
  });

  test("opens protected local-mode surfaces without a hosted session", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Workspace controls" })).toBeVisible();
    await expect(page.getByText("Local mode").first()).toBeVisible();

    // The Studio route was retired (#491); the Library is the protected entry.
    await page.goto("/library/projects");
    await expect(page.getByRole("navigation", { name: "Library collections" })).toBeVisible();
  });

  test("direct protected routes wait for workspace bootstrap before showing data", async ({
    page,
  }) => {
    await page.unroute("**/api/v1/me");
    await page.unroute("**/api/v1/projects?**");
    await page.unroute("**/api/v1/workspaces/*/dashboard");

    let meGate = deferred();
    const meMethods: string[] = [];
    await page.route("**/api/v1/me", async (route) => {
      meMethods.push(route.request().method());
      await meGate.promise;
      await fulfillJson(route, {
        actor: { id: "local_dev", type: "local", email: "local@popcornready.test" },
        workspaceId,
        workspaceName: "E2E Local Workspace",
        authMode: "local",
        isLocal: true,
      });
    });
    await page.route("**/api/v1/projects?**", (route) =>
      fulfillJson(route, {
        projects: [
          {
            id: "project-bootstrap",
            schemaVersion: "project.v1",
            workspaceId,
            name: "Bootstrap project",
            status: "active",
            visibility: "private",
            createdAt: now,
            updatedAt: now,
          },
        ],
        pagination: { limit: 24, nextCursor: null },
      }),
    );
    await page.route("**/api/v1/workspaces/*/dashboard", (route) =>
      fulfillJson(route, {
        summary: {
          schemaVersion: "dashboard.v1",
          counts: { projects: 1, activeRuns: 1, outputs: 0 },
          activeRuns: [
            {
              runId: "run-bootstrap",
              projectId: "project-bootstrap",
              projectName: "Bootstrap project",
              status: "failed",
              currentStageType: "quality_review",
              progressPercent: 50,
              updatedAt: now,
            },
          ],
          recentOutputs: [],
        },
      }),
    );

    await page.goto("/library/projects");
    await expect(page.getByTestId("quick-loading")).toBeVisible();
    await expect(page.getByRole("heading", { name: "No projects yet" })).toHaveCount(0);
    meGate.resolve();
    await expect(page.getByRole("link", { name: "Bootstrap project", exact: true })).toBeVisible();

    meGate = deferred();
    await page.goto("/activity");
    await expect(page.getByTestId("quick-loading")).toBeVisible();
    await expect(page.getByRole("heading", { name: "No active generations" })).toHaveCount(0);
    meGate.resolve();
    await expect(page.getByRole("heading", { name: "In progress" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open failure details for Bootstrap project" }),
    ).toBeVisible();
    expect(meMethods).toEqual(["GET", "GET"]);
  });

  test("keeps compatibility redirects and not-found route working", async ({ page }) => {
    await page.goto("/projects?source=smoke");
    await expect(page).toHaveURL(/\/library\/projects\?source=smoke$/);
    await expectNoAppCrash(page);

    await page.goto("/runs?status=running");
    await expect(page).toHaveURL(/\/library\/projects$/);
    await expectNoAppCrash(page);

    await page.goto("/assets");
    await expect(page).toHaveURL(/\/library\/assets$/);
    await expectNoAppCrash(page);

    await page.goto("/outputs");
    await expect(page).toHaveURL(/\/library\/projects$/);
    await expectNoAppCrash(page);

    await page.goto("/library");
    await expect(page).toHaveURL(/\/library\/projects$/);
    await expectNoAppCrash(page);

    await page.goto("/route-that-does-not-exist");
    await expect(page.getByRole("heading", { name: "That page isn’t here." })).toBeVisible();
    const notFound = page.getByRole("region", { name: "That page isn’t here." });
    await expect(notFound.getByRole("link", { name: "Go to homepage" })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(notFound.getByRole("link", { name: "Open dashboard" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
    await expect(page.getByText(/migrating from Next/i)).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("heading", { name: "That page isn’t here." })).toBeVisible();
    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(overflow.scrollWidth).toBe(overflow.clientWidth);
  });
});
