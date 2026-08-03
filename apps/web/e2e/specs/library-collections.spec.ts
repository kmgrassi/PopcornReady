import { expect, test, type Page, type Route } from "@playwright/test";
import { mockLocalApi, workspaceId } from "../fixtures/local-api";
import { projectMediaDraftKey } from "../../src/routes/projectMediaDraft";

const now = "2026-06-16T14:00:00.000Z";
const imageDataUrl =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 360'%3E%3Crect width='640' height='360' fill='%230f766e'/%3E%3Ctext x='42' y='196' fill='white' font-size='48' font-family='Arial'%3ELibrary asset%3C/text%3E%3C/svg%3E";
let assetBillingRequests = 0;

type JsonValue = Record<string, unknown> | Array<unknown>;

function json(route: Route, body: JsonValue) {
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

function image(route: Route, label: string, status = 200) {
  return route.fulfill({
    status,
    headers: {
      "cache-control": "private, max-age=31536000, immutable",
      "content-type": "image/svg+xml",
    },
    body: status === 200
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#0f766e"/><text x="42" y="196" fill="white" font-size="48">${label}</text></svg>`
      : "missing",
  });
}

function project(index: number) {
  return {
    id: index === 1 ? "proj-alpha" : `proj-${index}`,
    schemaVersion: "project.v1",
    workspaceId,
    name: index === 1 ? "Project Alpha" : `Project ${index}`,
    status: "active",
    visibility: "private",
    hasStoryboard: index % 2 === 0,
    posterUrl: index === 1 ? imageDataUrl : null,
    posterAssetId: index === 1 ? "asset-image-ready" : null,
    createdAt: now,
    updatedAt: now,
  };
}

async function trackQuickLoadingAppearance(page: Page) {
  await page.addInitScript(() => {
    const trackedWindow = window as Window & { __quickLoadingSeen?: boolean };
    trackedWindow.__quickLoadingSeen = false;

    const includesQuickLoading = (node: Node) => {
      if (!(node instanceof Element)) return false;
      return (
        node.matches('[data-testid="quick-loading"]') ||
        Boolean(node.querySelector('[data-testid="quick-loading"]'))
      );
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          (mutation.type === "attributes" && includesQuickLoading(mutation.target)) ||
          Array.from(mutation.addedNodes).some(includesQuickLoading)
        ) {
          trackedWindow.__quickLoadingSeen = true;
          observer.disconnect();
          return;
        }
      }
    });

    observer.observe(document, {
      attributes: true,
      attributeFilter: ["data-testid"],
      childList: true,
      subtree: true,
    });
  });
}

function quickLoadingWasSeen(page: Page) {
  return page.evaluate(() =>
    Boolean((window as Window & { __quickLoadingSeen?: boolean }).__quickLoadingSeen),
  );
}

async function mockLibraryApi(page: Page) {
  let assetVisibility: "public" | "private" = "private";

  await mockLocalApi(page);

  await page.route("**/api/v1/projects?**", async (route) => {
    const url = new URL(route.request().url());
    const cursor = url.searchParams.get("cursor");
    return json(route, {
      projects: cursor === "page-2"
        ? [project(25), project(26)]
        : Array.from({ length: 24 }, (_, index) => project(index + 1)),
      pagination: { limit: 24, nextCursor: cursor === "page-2" ? null : "page-2" },
    });
  });

  await page.route("**/api/v1/projects/proj-alpha", (route) =>
    json(route, { project: project(1) }),
  );

  await page.route("**/api/v1/projects/proj-alpha/storyboard", (route) =>
    json(route, { storyboard: null }),
  );

  await page.route(/\/api\/v1\/projects\/proj-alpha\/assets(?:\?.*)?$/, (route) =>
    json(route, {
      assets: [
        {
          id: "asset-project-media",
          schemaVersion: "asset.v1",
          projectId: "proj-alpha",
          workspaceId,
          kind: "image",
          status: "ready",
          filename: "project-keyframe.png",
          name: "Project keyframe",
          url: imageDataUrl,
          thumbnailUrl: imageDataUrl,
          durationSec: 0,
          source: "generated",
          createdAt: now,
          updatedAt: now,
        },
      ],
      pagination: { limit: 100, nextCursor: null },
    }),
  );

  await page.route("**/api/v1/workspaces/*/generation-runs?**", async (route) => {
    const url = new URL(route.request().url());
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
  });

  await page.route("**/api/v1/workspaces/*/assets?**", async (route) => {
    const url = new URL(route.request().url());
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
        prompt: "A bright editorial keyframe.",
        url: imageDataUrl,
        thumbnailUrl: imageDataUrl,
        visibility: assetVisibility,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "asset-image-processing",
        assetId: "asset-image-processing",
        projectId: "proj-alpha",
        projectName: "Project Alpha",
        kind: "image",
        status: "processing",
        source: "generated",
        title: "Processing still",
        filename: "processing.png",
        url: imageDataUrl,
        thumbnailUrl: imageDataUrl,
        visibility: "private",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "asset-image-failed",
        assetId: "asset-image-failed",
        projectId: "proj-alpha",
        projectName: "Project Alpha",
        kind: "image",
        status: "failed",
        source: "generated",
        title: "Failed still",
        filename: "failed.png",
        url: imageDataUrl,
        thumbnailUrl: imageDataUrl,
        visibility: "private",
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
  });

  await page.route("**/api/v1/discover/assets?**", (route) =>
    json(route, {
      assets: [
        {
          id: "asset-image-ready",
          projectId: "proj-alpha",
          workspaceId: "workspace-public",
          kind: "image",
          status: "ready",
          filename: "Keyframe still",
          remoteUrl: imageDataUrl,
          source: { type: "generated" },
          createdAt: now,
          updatedAt: now,
        },
      ],
      pagination: { limit: 24, nextCursor: null },
    }),
  );

  await page.route("**/api/v1/assets/asset-video-missing/media", (route) =>
    json(route, {
      url: imageDataUrl,
      thumbnailUrl: imageDataUrl,
      expiresAt: "2026-06-16T15:00:00.000Z",
    }),
  );

  await page.route("**/api/v1/projects/proj-alpha/assets/asset-image-ready/visibility", (route) => {
    const body = route.request().postDataJSON() as { visibility?: "public" | "private" };
    assetVisibility = body.visibility ?? assetVisibility;
    return json(route, { asset: { id: "asset-image-ready", visibility: assetVisibility } });
  });

  await page.route("**/api/v1/projects/proj-alpha/assets/asset-image-ready", (route) => {
    assetBillingRequests += 1;
    return json(route, {
      asset: { id: "asset-image-ready" },
      billing: { creditsCharged: 84 },
    });
  });

  await page.route("**/api/v1/projects/proj-alpha/assets/asset-project-media", (route) => {
    assetBillingRequests += 1;
    return json(route, {
      asset: {
        id: "asset-project-media",
        schemaVersion: "asset.v1",
        projectId: "proj-alpha",
        workspaceId,
        kind: "image",
        status: "ready",
        filename: "project-keyframe.png",
        name: "Project keyframe",
        url: imageDataUrl,
        thumbnailUrl: imageDataUrl,
        durationSec: 0,
        source: "generated",
        createdAt: now,
        updatedAt: now,
      },
      billing: { creditsCharged: 84 },
    });
  });

  await page.route("**/api/v1/workspaces/*/outputs?**", (route) =>
    json(route, {
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
    }),
  );

  await page.route("**/api/v1/projects/proj-alpha/watch", (route) =>
    json(route, {
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
    }),
  );
}

test.beforeEach(async ({ page }) => {
  assetBillingRequests = 0;
  await mockLibraryApi(page);
});

test("normalizes a deep-linked project's remote URL as the video viewer source", async ({ page }) => {
  await page.route("**/api/v1/projects/proj-alpha/assets/asset-deep-video", (route) =>
    json(route, {
      asset: {
        id: "asset-deep-video",
        schemaVersion: "asset.v1",
        projectId: "proj-alpha",
        workspaceId,
        kind: "video",
        status: "ready",
        filename: "deep-video.mp4",
        name: "Deep-linked video",
        remoteUrl: imageDataUrl,
        thumbnailUrl: imageDataUrl,
        durationSec: 12,
        source: "generated",
        createdAt: now,
        updatedAt: now,
      },
      billing: { creditsCharged: 21 },
    }),
  );
  await page.route("**/api/v1/assets/asset-deep-video/media", (route) => route.abort());

  await page.goto("/library/assets?assetId=asset-deep-video&projectId=proj-alpha");

  const dialog = page.getByRole("dialog", { name: "Deep-linked video" });
  await expect(dialog.locator("video")).toHaveAttribute("src", imageDataUrl);
});

test("uses a delayed content-shaped state for route-level library loading", async ({ page }) => {
  await trackQuickLoadingAppearance(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.unroute("**/api/v1/projects?**");
  await page.route("**/api/v1/projects?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 750));
    return json(route, {
      projects: [project(1)],
      pagination: { limit: 24, nextCursor: null },
    });
  });

  await page.goto("/library/projects");
  const loadingState = page.getByTestId("quick-loading");
  await expect(loadingState).toBeAttached();
  expect(await quickLoadingWasSeen(page)).toBe(true);
  await expect(loadingState).toHaveAttribute("aria-busy", "true");
  await expect(loadingState).toContainText("Loading projects");
  await expect(page.getByTestId("studio-crew")).toHaveCount(0);
  const reservation = page.getByTestId("quick-loading-reservation");
  await expect(reservation).toHaveAttribute("aria-hidden", "true");
  await expect(reservation).toBeVisible();
  const reservationIsStill = await reservation.evaluate((element) => {
    const nodes = [element, ...element.querySelectorAll("*")];
    return nodes.every((node) =>
      [null, "::before", "::after"].every((pseudo) => {
        const style = getComputedStyle(node, pseudo);
        return style.animationName === "none" && style.transitionDuration === "0s";
      }),
    );
  });
  expect(reservationIsStill).toBe(true);
  await expect(page.getByTestId("quick-loading")).toHaveCount(1);
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);

  await expect(loadingState).toHaveCount(0);
  await expect(page.getByText("Project Alpha")).toBeVisible();
});

test("uses the compact panel state while a project render loads", async ({ page }) => {
  await page.unroute("**/api/v1/projects/proj-alpha/watch");
  await page.route("**/api/v1/projects/proj-alpha/watch", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 750));
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
  });

  await page.goto("/projects/proj-alpha/watch");
  const loadingState = page.getByTestId("quick-loading");
  await expect(loadingState).toBeVisible();
  await expect(loadingState).toHaveAttribute("data-variant", "panel");
  await expect(loadingState).toContainText("Loading render");
  await expect(page.getByTestId("studio-crew")).toHaveCount(0);
  const reservation = page.getByTestId("quick-loading-reservation");
  await expect(reservation).toBeVisible();
  const panelGeometry = await reservation.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    viewport: document.documentElement.clientHeight,
  }));
  expect(panelGeometry.height).toBeGreaterThanOrEqual(420);
  expect(panelGeometry.height).toBeLessThan(panelGeometry.viewport);

  await expect(loadingState).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Project Alpha" })).toBeVisible();
});

test("does not flash a loading state for a cache-fast library request", async ({ page }) => {
  await trackQuickLoadingAppearance(page);
  await page.unroute("**/api/v1/projects?**");
  await page.route("**/api/v1/projects?**", (route) =>
    json(route, {
      projects: [project(1)],
      pagination: { limit: 24, nextCursor: null },
    }),
  );

  await page.goto("/library/projects");
  await expect(page.getByText("Project Alpha")).toBeVisible();
  await page.waitForTimeout(200);
  expect(await quickLoadingWasSeen(page)).toBe(false);
  await expect(page.getByTestId("quick-loading")).toHaveCount(0);
});

test("covers library pagination, filters, media viewer, visibility, and watch links", async ({ page }) => {
  let proposalRequestBody: unknown = null;
  await page.route("**/api/v1/projects/proj-alpha/rerun-proposals/v2", async (route) => {
    proposalRequestBody = await route.request().postDataJSON();
    const target = {
      kind: "asset",
      projectId: "proj-alpha",
      assetId: "asset-image-ready",
    };
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        actionId: "22222222-2222-4222-8222-222222222222",
        proposal: {
          schemaVersion: "RerunProposal.v2",
          projectId: "proj-alpha",
          source: "request_changes",
          userIntent: "Make the background less busy.",
          targets: [target],
          inspectedAssetIds: ["asset-image-ready"],
          candidateAffectedAssetIds: ["asset-image-ready"],
          preservedAssetIds: [],
          checklist: [{ target, decision: "change", reason: "Revise this image." }],
          pins: { assets: [], selections: [], storySnapshots: [] },
          estimate: { costUsd: 0.1, maxCostUsd: 0.2, latencyClass: "interactive" },
          risk: "low",
          requiresApproval: true,
          rationale: "Only the selected image needs to change.",
          userFacingSummary: "Revise the selected image",
          outcome: "revision",
          selectedWork: [],
          plannedSelectionMoves: [],
          plannedStoryPointerMoves: [],
        },
      }),
    });
  });

  await page.goto("/library");
  const tabs = page.getByLabel("Library collections");
  await expect(page).toHaveURL(/\/library\/projects$/);
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByText("Project Alpha")).toBeVisible();

  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByText("Project 25")).toBeVisible();

  await expect(tabs.getByRole("link", { name: "Runs", exact: true })).toHaveCount(0);
  await expect(tabs.getByRole("link", { name: "Outputs", exact: true })).toHaveCount(0);
  await expect(tabs.getByRole("link", { name: "Evals", exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "Project Alpha", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/proj-alpha$/);
  await expect(page.getByRole("link", { name: "Runs" })).toHaveAttribute(
    "href",
    "/projects/proj-alpha/runs/run-running",
  );
  await expect(page.getByRole("link", { name: "Outputs" })).toHaveAttribute(
    "href",
    "/projects/proj-alpha/watch",
  );
  await expect(page.getByRole("link", { name: "Watch" })).toHaveAttribute(
    "href",
    "/projects/proj-alpha/watch",
  );
  await expect(page.getByRole("heading", { name: "Recent generation work" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Finished exports" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View Project Alpha poster asset" })).toHaveAttribute(
    "href",
    "/library/assets?assetId=asset-image-ready&projectId=proj-alpha",
  );

  await page.goto("/library/projects");

  await tabs.getByRole("link", { name: "Assets", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Assets" })).toBeVisible();
  await page.getByLabel("Kind").selectOption("video");
  await page.getByLabel("Source").selectOption("uploaded");
  await expect(page.getByText("Archive teaser").first()).toBeVisible();

  const mediaRefresh = page.waitForResponse("**/api/v1/assets/asset-video-missing/media");
  await page.getByRole("button", { name: "View Archive teaser" }).click();
  const mediaRefreshResponse = await mediaRefresh;
  expect(mediaRefreshResponse.ok()).toBe(true);
  await expect(page.getByRole("dialog", { name: "Archive teaser" }).locator("video")).toHaveAttribute(
    "src",
    imageDataUrl,
  );
  await expect(page.getByRole("dialog", { name: "Archive teaser" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Archive teaser" })).toBeHidden();

  await page.getByLabel("Kind").selectOption("image");
  await page.getByLabel("Source").selectOption("generated");
  const keyframeCard = page.getByRole("button", { name: "View Keyframe still" });
  await expect(keyframeCard.locator("span[data-private='true']")).toHaveText("Private");
  await keyframeCard.click();
  const keyframeDialog = page.getByRole("dialog", { name: "Keyframe still" });
  await expect(keyframeDialog).toBeVisible();
  await expect(keyframeDialog.getByText("84 credits used")).toBeVisible();
  const requestChanges = keyframeDialog.getByRole("button", { name: "Request changes" });
  await expect(requestChanges).toBeVisible();
  await expect(requestChanges).toBeEnabled();
  await expect(keyframeDialog.getByText("Tell the AI what you want to change.")).toBeVisible();
  await requestChanges.click();
  await expect(keyframeDialog).toBeHidden();
  const editDialog = page.getByRole("dialog", { name: "Request changes" });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByText("A bright editorial keyframe.")).toBeVisible();
  await editDialog.getByLabel("What should change?").fill("Make the background less busy.");
  await editDialog.getByRole("button", { name: "Preview changes" }).click();
  await expect(editDialog.getByRole("heading", { name: "Revise the selected image" })).toBeVisible();
  expect(proposalRequestBody).toEqual({
    message: "Make the background less busy.",
    targets: [{
      kind: "asset",
      projectId: "proj-alpha",
      assetId: "asset-image-ready",
    }],
  });
  await page.keyboard.press("Escape");
  await expect(editDialog).toBeHidden();
  await expect(keyframeDialog).toBeVisible();
  await expect(page).toHaveURL(/\/library\/assets\?assetId=asset-image-ready$/);
  await expect(keyframeDialog.getByRole("button", { name: "Request changes" })).toBeFocused();
  expect(assetBillingRequests).toBe(1);
  await keyframeDialog.getByRole("button", { name: "Make public" }).click();
  await expect(page.locator("span[data-private='false']")).toHaveText("Public");
  await page.keyboard.press("Escape");
  await expect(keyframeDialog).toBeHidden();

  await page.getByRole("button", { name: "View Processing still" }).click();
  const processingDialog = page.getByRole("dialog", { name: "Processing still" });
  await expect(processingDialog).toBeVisible();
  await expect(processingDialog.getByRole("button", { name: "Request changes" })).toBeDisabled();
  await expect(processingDialog.getByText("Available when this asset is ready.")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "View Failed still" }).click();
  const failedDialog = page.getByRole("dialog", { name: "Failed still" });
  await expect(failedDialog.getByRole("button", { name: "Request changes" })).toBeDisabled();
  await expect(failedDialog.getByText(
    "Request changes is unavailable because this asset failed.",
  )).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByLabel("Show").selectOption("public");
  await expect(page.getByText("Keyframe still").first()).toBeVisible();
  await page.getByRole("button", { name: "View Keyframe still" }).click();
  const publicDialog = page.getByRole("dialog", { name: "Keyframe still" });
  await expect(publicDialog).toBeVisible();
  await expect(publicDialog.getByRole("button", { name: "Request changes" })).toHaveCount(0);
  await expect(publicDialog.getByText(/credits? used/)).toHaveCount(0);
  expect(assetBillingRequests).toBe(1);
  await page.keyboard.press("Escape");

  await page.goto("/projects/proj-alpha/media");
  await expect(page.getByRole("heading", {
    name: "Choose from the clips attached to this project",
  })).toBeVisible();
  const projectMediaLink = page.getByRole("link", { name: "View Project keyframe" });
  const projectMediaTile = projectMediaLink.locator("..");
  await projectMediaTile.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByLabel("Idea").selectOption("montage");
  await expect(page.getByLabel("What should we make with these?")).toHaveValue(
    "Cut these into a montage with a fitting soundtrack.",
  );
  const projectMediaBilling = page.waitForResponse(
    "**/api/v1/projects/proj-alpha/assets/asset-project-media",
  );
  await projectMediaLink.click();
  expect((await projectMediaBilling).ok()).toBe(true);
  await expect(page).toHaveURL(
    /\/library\/assets\?assetId=asset-project-media&projectId=proj-alpha$/,
  );
  const projectMediaDialog = page.getByRole("dialog", { name: "Project keyframe" });
  await expect(projectMediaDialog.getByText("84 credits used")).toBeVisible();
  await expect(projectMediaDialog.getByRole("button", { name: "Request changes" })).toBeVisible();
  await expect(projectMediaDialog.getByRole("button", { name: "Make public" })).toHaveCount(0);
  await expect(projectMediaDialog.getByRole("button", { name: "Make private" })).toHaveCount(0);
  expect(assetBillingRequests).toBe(2);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/library\/assets$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/projects\/proj-alpha\/media$/);
  await expect(projectMediaTile.getByRole("button", { name: "Selected 1" })).toBeVisible();
  await expect(page.getByLabel("Idea")).toHaveValue("montage");
  await expect(page.getByLabel("What should we make with these?")).toHaveValue(
    "Cut these into a montage with a fitting soundtrack.",
  );
  expect(await page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    projectMediaDraftKey("proj-alpha"),
  )).toBeNull();

  await page.goto("/projects/proj-alpha");
  await page.getByRole("link", { name: "Watch" }).click();
  await expect(page).toHaveURL(/\/projects\/proj-alpha\/watch$/);
  await expect(page.getByRole("heading", { name: "Project Alpha" })).toBeVisible();
});

test("reuses one auth-scoped media URL across the project gallery, library, and reload", async ({ page }) => {
  const projectSignedUrl = "/__e2e_media__/shared.svg?signature=project";
  const librarySignedUrl = "/__e2e_media__/shared.svg?signature=library";
  const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
  let focusedMediaRequests = 0;

  await page.unroute(/\/api\/v1\/projects\/proj-alpha\/assets(?:\?.*)?$/);
  await page.route(/\/api\/v1\/projects\/proj-alpha\/assets(?:\?.*)?$/, (route) =>
    json(route, {
      assets: [{
        id: "asset-shared",
        schemaVersion: "asset.v1",
        projectId: "proj-alpha",
        workspaceId,
        kind: "image",
        status: "ready",
        filename: "shared.png",
        name: "Shared keyframe",
        url: projectSignedUrl,
        thumbnailUrl: projectSignedUrl,
        expiresAt,
        visibility: "private",
        source: "generated",
        createdAt: now,
        updatedAt: now,
      }],
      pagination: { limit: 100, nextCursor: null },
    }),
  );
  await page.unroute("**/api/v1/workspaces/*/assets?**");
  await page.route("**/api/v1/workspaces/*/assets?**", (route) =>
    json(route, {
      assets: [{
        id: "asset-shared",
        assetId: "asset-shared",
        projectId: "proj-alpha",
        projectName: "Project Alpha",
        kind: "image",
        status: "ready",
        source: "generated",
        title: "Shared keyframe",
        filename: "shared.png",
        url: librarySignedUrl,
        thumbnailUrl: librarySignedUrl,
        expiresAt,
        visibility: "private",
        createdAt: now,
        updatedAt: now,
      }],
      pagination: { limit: 24, nextCursor: null },
    }),
  );
  await page.route("**/__e2e_media__/shared.svg?**", (route) => image(route, "Shared"));
  await page.route("**/api/v1/assets/asset-shared/media", (route) => {
    focusedMediaRequests += 1;
    return json(route, { url: projectSignedUrl, thumbnailUrl: projectSignedUrl, expiresAt });
  });

  await page.goto("/projects/proj-alpha/media");
  await expect(page.getByRole("link", { name: "View Shared keyframe" }).locator("img"))
    .toHaveAttribute("src", projectSignedUrl);

  await page.goto("/library/assets");
  const libraryImage = page.getByRole("button", { name: "View Shared keyframe" }).locator("img");
  await expect(libraryImage).toHaveAttribute("src", projectSignedUrl);
  await page.reload();
  await expect(page.getByRole("button", { name: "View Shared keyframe" }).locator("img"))
    .toHaveAttribute("src", projectSignedUrl);
  expect(focusedMediaRequests).toBe(0);
});

test("@mobile retries failed media once with a newly signed URL", async ({ page }) => {
  const failedUrl = "/__e2e_media__/failed.svg?signature=old";
  const freshUrl = "/__e2e_media__/fresh.svg?signature=new";
  const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
  let focusedMediaRequests = 0;

  await page.unroute("**/api/v1/workspaces/*/assets?**");
  await page.route("**/api/v1/workspaces/*/assets?**", (route) =>
    json(route, {
      assets: [{
        id: "asset-retry",
        assetId: "asset-retry",
        projectId: "proj-alpha",
        projectName: "Project Alpha",
        kind: "image",
        status: "ready",
        source: "generated",
        title: "Recoverable keyframe",
        filename: "recoverable.png",
        url: failedUrl,
        thumbnailUrl: failedUrl,
        expiresAt,
        visibility: "private",
        createdAt: now,
        updatedAt: now,
      }],
      pagination: { limit: 24, nextCursor: null },
    }),
  );
  await page.route("**/__e2e_media__/failed.svg?**", (route) => image(route, "Missing", 404));
  await page.route("**/__e2e_media__/fresh.svg?**", (route) => image(route, "Recovered"));
  await page.route("**/api/v1/assets/asset-retry/media", (route) => {
    focusedMediaRequests += 1;
    return json(route, { url: freshUrl, thumbnailUrl: freshUrl, expiresAt });
  });

  await page.goto("/library/assets");
  const recovered = page.getByRole("button", { name: "View Recoverable keyframe" }).locator("img");
  await expect(recovered).toHaveAttribute("src", freshUrl);
  await expect(recovered).toBeVisible();
  expect(focusedMediaRequests).toBe(1);
});

test("@mobile keeps Request changes prominent and explains processing state", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/library/assets");
  await page.getByRole("button", { name: "View Keyframe still" }).click();

  const readyDialog = page.getByRole("dialog", { name: "Keyframe still" });
  const requestChanges = readyDialog.getByRole("button", { name: "Request changes" });
  await expect(requestChanges).toBeVisible();
  await expect(requestChanges).toBeEnabled();
  await expect(readyDialog.getByText("Tell the AI what you want to change.")).toBeVisible();

  const readyGeometry = await requestChanges.evaluate((button) => {
    const buttonRect = button.getBoundingClientRect();
    const dialogRect = button.closest('[role="dialog"]')?.getBoundingClientRect();
    return {
      buttonWidth: buttonRect.width,
      dialogWidth: dialogRect?.width ?? 0,
      buttonBottom: buttonRect.bottom,
      viewportHeight: document.documentElement.clientHeight,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      isTopmost: Boolean(
        document.elementFromPoint(
          buttonRect.left + buttonRect.width / 2,
          buttonRect.top + buttonRect.height / 2
        ) &&
          button.contains(
            document.elementFromPoint(
              buttonRect.left + buttonRect.width / 2,
              buttonRect.top + buttonRect.height / 2
            )
          )
      ),
    };
  });
  expect(readyGeometry.buttonWidth).toBeGreaterThan(readyGeometry.dialogWidth * 0.7);
  expect(readyGeometry.buttonBottom).toBeLessThanOrEqual(readyGeometry.viewportHeight);
  expect(readyGeometry.documentWidth).toBeLessThanOrEqual(readyGeometry.viewportWidth + 1);
  expect(readyGeometry.isTopmost).toBe(true);

  await page.setViewportSize({ width: 844, height: 390 });
  const shortViewportGeometry = await requestChanges.evaluate((button) => {
    const buttonRect = button.getBoundingClientRect();
    const topElement = document.elementFromPoint(
      buttonRect.left + buttonRect.width / 2,
      buttonRect.top + buttonRect.height / 2
    );
    return {
      buttonBottom: buttonRect.bottom,
      viewportHeight: document.documentElement.clientHeight,
      isTopmost: Boolean(topElement && button.contains(topElement)),
    };
  });
  expect(shortViewportGeometry.buttonBottom).toBeLessThanOrEqual(
    shortViewportGeometry.viewportHeight
  );
  expect(shortViewportGeometry.isTopmost).toBe(true);

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "View Processing still" }).click();
  const processingDialog = page.getByRole("dialog", { name: "Processing still" });
  await expect(processingDialog.getByRole("button", { name: "Request changes" })).toBeDisabled();
  await expect(processingDialog.getByText("Available when this asset is ready.")).toBeVisible();
});
