import { expect, type Page, type Route } from "@playwright/test";

const workspaceId = "e2e_local_workspace";
const now = "2026-06-16T00:00:00.000Z";
const emptyPagination = { limit: 24, nextCursor: null };

async function json(route: Route, body: unknown, status = 200) {
  const origin = route.request().headers().origin;
  await route.fulfill({
    status,
    headers: {
      "access-control-allow-credentials": "true",
      "access-control-allow-origin": origin ?? "*",
      "content-type": "application/json",
      vary: "origin",
    },
    body: JSON.stringify(body),
  });
}

export async function mockLocalApi(page: Page) {
  await page.route("**/api/v1/me", (route) =>
    json(route, {
      actor: { id: "local_dev", type: "local", email: "local@popcornready.test" },
      workspaceId,
      workspaceName: "E2E Local Workspace",
      authMode: "local",
      isLocal: true,
    }),
  );

  await page.route("**/api/v1/workspaces/*/dashboard", (route) =>
    json(route, {
      summary: {
        schemaVersion: "dashboard.v1",
        counts: { projects: 0, activeRuns: 0, outputs: 0 },
        activeRuns: [],
        recentOutputs: [],
      },
    }),
  );

  await page.route("**/api/v1/projects?**", (route) =>
    json(route, { projects: [], pagination: emptyPagination }),
  );
  await page.route("**/api/v1/workspaces/*/generation-runs?**", (route) =>
    json(route, { runs: [], pagination: emptyPagination }),
  );
  await page.route("**/api/v1/workspaces/*/assets?**", (route) =>
    json(route, { assets: [], pagination: emptyPagination }),
  );
  await page.route("**/api/v1/workspaces/*/outputs?**", (route) =>
    json(route, { outputs: [], pagination: emptyPagination }),
  );
  await page.route(/\/api\/v1\/workspaces\/[^/]+\/studio-drafts(?:\?.*)?$/, (route) =>
    json(route, { drafts: [], pagination: { limit: 20, nextCursor: null } }),
  );
}

export async function expectNoAppCrash(page: Page) {
  await expect(page.getByRole("link", { name: "Popcorn Ready" }).first()).toBeVisible();
}

export { now, workspaceId };
