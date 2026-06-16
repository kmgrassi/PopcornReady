import { expect, test, type Page, type Route } from "@playwright/test";

const workspaceId = "workspace-library-e2e";
const now = "2026-06-16T14:00:00.000Z";
const imageDataUrl =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 360'%3E%3Crect width='640' height='360' fill='%230f766e'/%3E%3Ctext x='42' y='196' fill='white' font-size='48' font-family='Arial'%3ELibrary asset%3C/text%3E%3C/svg%3E";

type JsonValue = Record<string, unknown> | Array<unknown>;

function json(route: Route, body: JsonValue) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function project(index: number) {
  return {
    id: `proj-${index}`,
    schemaVersion: "project.v1",
    workspaceId,
    name: index === 1 ? "Project Alpha" : `Project ${index}`,
    status: "active",
    visibility: "private",
    hasStoryboard: index % 2 === 0,
    posterUrl: index === 1 ? imageDataUrl : null,
    createdAt: now,
    updatedAt: now,
  };
}

async function mockLibraryApi(page: Page) {
  let assetVisibility: "public" | "private" = "private";

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/v1/me") {
      return json(route, {
        actor: { id: "local-user", type: "local", email: "local@example.test" },
        workspaceId,
        workspaceName: "Library E2E",
        authMode: "local",
        isLocal: true,
      });
    }

    if (path === "/api/v1/projects") {
      const cursor = url.searchParams.get("cursor");
      return json(route, {
        projects: cursor === "page-2"
          ? [project(25), project(26)]
          : Array.from({ length: 24 }, (_, index) => project(index + 1)),
        pagination: { limit: 24, nextCursor: cursor === "page-2" ? null : "page-2" },
      });
    }

    if (path === `/api/v1/workspaces/${workspaceId}/generation-runs`) {
      const status = url.searchParams.get("status");
      const projectId = url.searchParams.get("projectId");
      return json(route, {
        runs: [
          {
            runId: status === "succeeded" ? "run-success" : "run-running",
            projectId: projectId ?? "proj-alpha",
            projectName: status === "succeeded" ? "Launch recap" : "Project Alpha",
            status: status ?? "running",
            currentStageType: "timeline_assembly",
            progressPercent: status === "succeeded" ? 100 : 68,
            createdAt: now,
            updatedAt: now,
          },
        ],
        pagination: { limit: 24, nextCursor: null },
      });
    }

    if (path === `/api/v1/workspaces/${workspaceId}/assets`) {
      const kind = url.searchParams.get("kind");
      const source = url.searchParams.get("source");
      const assets = [
        {
          id: "asset-image-ready",
          assetId: "asset-image-ready",
          projectId: "proj-alpha",
          projectName: "Project Alpha",
          kind: "image",
          status: "ready",
          source: "generated",
          title: "Keyframe still",
          filename: "keyframe.png",
          url: imageDataUrl,
          thumbnailUrl: imageDataUrl,
          visibility: assetVisibility,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "asset-video-missing",
          assetId: "asset-video-missing",
          projectId: "proj-beta",
          projectName: "Project Beta",
          kind: "video",
          status: "ready",
          source: "uploaded",
          title: "Archive teaser",
          filename: "archive-teaser.mp4",
          durationSec: 12,
          visibility: "public",
          createdAt: now,
          updatedAt: now,
        },
      ].filter((asset) => {
        return (!kind || asset.kind === kind) && (!source || asset.source === source);
      });

      return json(route, {
        assets,
        pagination: { limit: 24, nextCursor: null },
      });
    }

    if (path === "/api/v1/assets/asset-video-missing/media") {
      return json(route, {
        url: imageDataUrl,
        thumbnailUrl: imageDataUrl,
        expiresAt: "2026-06-16T15:00:00.000Z",
      });
    }

    if (path === "/api/v1/projects/proj-alpha/assets/asset-image-ready/visibility") {
      const body = request.postDataJSON() as { visibility?: "public" | "private" };
      assetVisibility = body.visibility ?? assetVisibility;
      return json(route, { asset: { id: "asset-image-ready", visibility: assetVisibility } });
    }

    if (path === `/api/v1/workspaces/${workspaceId}/outputs`) {
      return json(route, {
        outputs: [
          {
            artifactId: "output-main",
            projectId: "proj-alpha",
            projectName: "Project Alpha",
            timelineId: "timeline-main",
            playbackUrl: imageDataUrl,
            thumbnailUrl: imageDataUrl,
            durationSec: 45,
            format: "mp4",
            createdAt: now,
          },
        ],
        pagination: { limit: 24, nextCursor: null },
      });
    }

    if (path === "/api/v1/projects/proj-alpha/watch") {
      return json(route, {
        media: {
          assetId: "output-main",
          projectId: "proj-alpha",
          projectName: "Project Alpha",
          filename: "project-alpha.mp4",
          kind: "video",
          url: imageDataUrl,
          posterUrl: imageDataUrl,
          durationSec: 45,
          createdAt: now,
          updatedAt: now,
        },
        fallback: { storyboardUrl: "/projects/proj-alpha/storyboard" },
      });
    }

    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "not_found", message: `No e2e fixture for ${path}` },
      }),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await mockLibraryApi(page);
});

test("covers library pagination, filters, media viewer, visibility, and watch links", async ({ page }) => {
  await page.goto("/library");
  const tabs = page.getByLabel("Library collections");
  await expect(page).toHaveURL(/\/library\/projects$/);
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByText("Project Alpha")).toBeVisible();

  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByText("Project 25")).toBeVisible();

  await tabs.getByRole("link", { name: "Runs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Runs" })).toBeVisible();
  await page.getByLabel("Status").selectOption("succeeded");
  await expect(page.getByText("Launch recap")).toBeVisible();
  await expect(page.getByRole("link", { name: /Launch recap/i })).toHaveAttribute(
    "href",
    "/projects/proj-alpha/runs/run-success",
  );

  await tabs.getByRole("link", { name: "Assets", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Assets" })).toBeVisible();
  await page.getByLabel("Kind").selectOption("video");
  await page.getByLabel("Source").selectOption("uploaded");
  await expect(page.getByText("Archive teaser").first()).toBeVisible();

  const mediaRefresh = page.waitForResponse("**/api/v1/assets/asset-video-missing/media");
  await page.getByRole("button", { name: "View Archive teaser" }).click();
  await mediaRefresh;
  await expect(page.getByRole("dialog", { name: "Archive teaser" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Archive teaser" })).toBeHidden();

  await page.getByLabel("Kind").selectOption("image");
  await page.getByLabel("Source").selectOption("generated");
  await expect(page.getByText("Private")).toBeVisible();
  await page.getByRole("button", { name: "Make public" }).click();
  await expect(page.getByText("Public")).toBeVisible();

  await tabs.getByRole("link", { name: "Outputs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Outputs" })).toBeVisible();
  await page.getByRole("button", { name: "View Project Alpha output" }).click();
  await expect(page.getByRole("dialog", { name: "Project Alpha" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "Watch" }).click();
  await expect(page).toHaveURL(/\/projects\/proj-alpha\/watch$/);
  await expect(page.getByRole("heading", { name: "Project Alpha" })).toBeVisible();
});
