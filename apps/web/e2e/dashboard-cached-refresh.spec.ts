import { expect, test, type Route } from "@playwright/test";
import { mockLocalApi } from "./fixtures/local-api";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function dashboard(projectName: string) {
  return {
    summary: {
      schemaVersion: "dashboard.v1",
      counts: { projects: 1, activeRuns: 1, outputs: 0 },
      activeRuns: [{
        runId: `run-${projectName}`,
        projectId: `project-${projectName}`,
        projectName,
        status: "failed",
        currentStageType: "quality_review",
        progressPercent: 50,
        updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      }],
      recentOutputs: [],
    },
  };
}

test.beforeEach(async ({ page }) => {
  await mockLocalApi(page);
});

test("hard reload renders the session snapshot while Home refreshes", async ({ page }) => {
  let mode: "seed" | "delayed" = "seed";
  const refreshGate = deferred();
  const refreshStarted = deferred();

  await page.route("**/api/v1/workspaces/*/dashboard", async (route) => {
    if (mode === "seed") {
      await json(route, dashboard("Cached launch"));
      return;
    }
    refreshStarted.resolve();
    await refreshGate.promise;
    await json(route, dashboard("Fresh launch"));
  });

  await page.goto("/dashboard");
  await expect(page.getByText("Cached launch", { exact: true })).toBeVisible();

  mode = "delayed";
  await page.reload();
  await refreshStarted.promise;
  await expect(page.getByText("Cached launch", { exact: true })).toBeVisible();
  await expect(page.getByText("Updating Home…", { exact: true })).toBeVisible();
  await expect(page.getByTestId("quick-loading")).toHaveCount(0);

  refreshGate.resolve();
  await expect(page.getByText("Fresh launch", { exact: true })).toBeVisible();
  await expect(page.getByText("Cached launch", { exact: true })).toHaveCount(0);
});

test("failed background refresh keeps cached Home content and retries in place", async ({
  page,
}) => {
  let failRefresh = false;
  let projectName = "Cached recovery";
  const retryGate = deferred();
  const retryStarted = deferred();

  await page.route("**/api/v1/workspaces/*/dashboard", async (route) => {
    if (failRefresh) {
      await json(route, { error: "temporary dashboard failure" }, 500);
      return;
    }
    if (projectName === "Fresh retry") {
      retryStarted.resolve();
      await retryGate.promise;
    }
    await json(route, dashboard(projectName));
  });

  await page.goto("/dashboard");
  await expect(page.getByText("Cached recovery", { exact: true })).toBeVisible();

  failRefresh = true;
  await page.reload();
  await expect(page.getByText("Cached recovery", { exact: true })).toBeVisible();
  const noticeMessage = page.getByRole("status").filter({
    hasText: "Showing your last update",
  });
  await expect(noticeMessage).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Unable to load Home" })).toHaveCount(0);

  failRefresh = false;
  projectName = "Fresh retry";
  await page.getByRole("button", { name: "Try again" }).click();
  await retryStarted.promise;
  const retryButton = page.getByRole("button", { name: "Trying again…" });
  await expect(retryButton).toBeFocused();
  await expect(retryButton).toHaveAttribute("aria-busy", "true");
  await retryButton.dispatchEvent("click");
  retryGate.resolve();
  await expect(page.getByText("Fresh retry", { exact: true })).toBeVisible();
  await expect(noticeMessage).toHaveCount(0);
});
