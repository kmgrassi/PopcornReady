import { expect, test, type Page, type Route } from "@playwright/test";
import { mockLocalApi, now, workspaceId } from "./fixtures/local-api";

const project = {
  id: "project_asset_studio",
  schemaVersion: "project.v1",
  workspaceId,
  name: "Campaign stills",
  status: "active",
  visibility: "private",
  createdAt: now,
  updatedAt: now,
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockAssetStudioProject(page: Page) {
  await page.route("**/api/v1/projects?**", (route) =>
    fulfillJson(route, {
      projects: [project],
      pagination: { limit: 100, nextCursor: null },
    }),
  );
}

test.describe("Asset Studio", () => {
  test.beforeEach(async ({ page }) => {
    await mockLocalApi(page);
    await mockAssetStudioProject(page);
  });

  test("creates an image only after explicit cost confirmation", async ({ page }) => {
    let proposalKind: string | null = null;
    let confirmationCount = 0;

    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/proposals`,
      async (route) => {
        const request = route.request();
        proposalKind = request.postDataJSON().kind;
        expect(request.headers()["idempotency-key"]).toMatch(/^asset-studio:proposal:/);
        await fulfillJson(
          route,
          {
            proposal: {
              sessionId: "session_image",
              runId: "run_image",
              gateId: "gate_image",
              requestDigest: "digest_image",
              maximumUsd: 10,
              approvalToken: "approval_image",
              expiresAt: "2026-07-29T18:00:00.000Z",
            },
          },
          201,
        );
      },
    );
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/proposals/gate_image/confirm`,
      async (route) => {
        confirmationCount += 1;
        await fulfillJson(
          route,
          { sessionId: "session_image", runId: "run_image", enqueued: true },
          202,
        );
      },
    );
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/run_image`,
      (route) =>
        fulfillJson(route, {
          sessionId: "session_image",
          run: {
            id: "run_image",
            status: "queued",
            inputSummary: "An amber-lit editorial popcorn still",
          },
          report: null,
          outputs: [],
        }),
    );

    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Create new asset" }).click();
    await expect(page).toHaveURL(/\/create$/);
    await expect(
      page.getByRole("radio", {
        name: "Image A visual for the project asset pool.",
      }),
    ).toBeChecked();

    await page
      .getByRole("combobox", { name: "Project", exact: true })
      .selectOption(project.id);
    await page
      .getByLabel("What should it feel like?", { exact: true })
      .fill("An amber-lit editorial popcorn still");
    await page.getByRole("button", { name: "Review cost" }).click();

    await expect(page.getByRole("heading", { name: "Review before starting" })).toBeVisible();
    expect(proposalKind).toBe("image_create");
    expect(confirmationCount).toBe(0);

    await page.getByRole("button", { name: "Confirm and start" }).click();

    await expect(page).toHaveURL(
      new RegExp(`/create\\?projectId=${project.id}&runId=run_image$`),
    );
    await expect(page.getByText("queued", { exact: true })).toBeVisible();
    expect(confirmationCount).toBe(1);
  });

  test("mobile Create opens Asset Studio and stays active @mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");

    const createTab = page.getByRole("button", { name: "Create", exact: true });
    await createTab.click();

    await expect(page).toHaveURL(/\/create$/);
    await expect(createTab).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("radio", {
        name: "Image A visual for the project asset pool.",
      }),
    ).toBeChecked();
  });
});
