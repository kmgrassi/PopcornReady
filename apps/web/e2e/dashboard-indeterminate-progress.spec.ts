import { expect, test, type Route } from "@playwright/test";
import { mockLocalApi } from "./fixtures/local-api";

function json(route: Route, body: unknown) {
  const origin = route.request().headers().origin;
  return route.fulfill({
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

test("home keeps unknown active progress visibly indeterminate", async ({ page }) => {
  await mockLocalApi(page);
  await page.route("**/api/v1/workspaces/*/dashboard", (route) =>
    json(route, {
      summary: {
        schemaVersion: "dashboard.v1",
        counts: { projects: 1, activeRuns: 1, outputs: 0 },
        activeRuns: [
          {
            runId: "run-working",
            projectId: "project-working",
            projectName: "Working launch",
            status: "running",
            currentStageType: "asset_generation",
            updatedAt: "2026-07-15T14:00:00.000Z",
          },
        ],
        recentOutputs: [],
      },
    }),
  );

  await page.goto("/dashboard");

  const runLink = page.getByRole("link", { name: "Open progress for Working launch" });
  await expect(runLink).toBeVisible();
  await expect(runLink.getByText("Working", { exact: true })).toBeVisible();
  const fill = runLink.locator('span[aria-hidden="true"] > span');
  await expect(fill).not.toHaveAttribute("style", /width/);
  await expect
    .poll(() => fill.evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThan(0);
});

test("failed Dashboard and Activity cards direct recovery through project changes", async ({
  page,
}) => {
  await mockLocalApi(page);
  await page.route("**/api/v1/workspaces/*/dashboard", (route) =>
    json(route, {
      summary: {
        schemaVersion: "dashboard.v1",
        counts: { projects: 1, activeRuns: 1, outputs: 0 },
        activeRuns: [
          {
            runId: "run-failed",
            projectId: "project-failed",
            projectName: "Stopped launch",
            status: "failed",
            currentStageType: "quality_review",
            progressPercent: 50,
            updatedAt: "2026-07-15T14:00:00.000Z",
          },
        ],
        recentOutputs: [],
      },
    }),
  );

  for (const path of ["/dashboard", "/activity"]) {
    await page.goto(path);
    const runLink = page.getByRole("link", {
      name: "Open failure details for Stopped launch",
    });
    await expect(runLink).toContainText(
      "Open the run to see what stopped. Request changes from the project when you are ready.",
    );
    await expect(runLink.getByText("See what stopped", { exact: true })).toBeVisible();
    await expect(runLink).not.toContainText(/retry/i);
  }
});
