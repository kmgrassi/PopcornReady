import { expect, test, type Page } from "@playwright/test";
import {
  mockAssetStudioProject,
  fulfillJson,
  project,
  longRunSummary,
} from "./fixtures/asset-studio";
import { mockLocalApi, workspaceId } from "./fixtures/local-api";

const refreshedPosterUrl =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 90'%3E%3Crect width='160' height='90' fill='%232f5a78'/%3E%3C/svg%3E";

test.describe("Asset Studio", () => {
  test.beforeEach(async ({ page }) => {
    await mockLocalApi(page);
    await mockAssetStudioProject(page);
  });

  test("keeps the progress state truthful across terminal outcomes", async ({ page }) => {
    let status: "failed" | "canceled" | "succeeded" | "blocked" | "question" =
      "failed";
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/run_terminal`,
      (route) => {
        const isBlocked = status === "blocked";
        const isQuestion = status === "question";
        return fulfillJson(route, {
          sessionId: "session_terminal",
          run: {
            id: "run_terminal",
            status: isBlocked || isQuestion ? "waiting" : status,
          },
          report: isBlocked
            ? {
                schemaVersion: "DomainReport.v1",
                outcome: {
                  outcome: "blocked",
                  precondition: {
                    requirement: "Choose a visual direction",
                    because: "The references point in two different directions",
                  },
                  requiredDomain: "visuals",
                  targets: [],
                  reason: "Choose between the warm and monochrome directions.",
                },
              }
            : isQuestion
              ? {
                  schemaVersion: "DomainReport.v1",
                  outcome: {
                    outcome: "question",
                    question: "Should the poster feel playful or ominous?",
                    targets: [],
                    options: [],
                    fingerprint: "question_fingerprint",
                  },
                }
              : null,
          outputs:
            status === "succeeded"
              ? [{
                  assetId: "asset_ready",
                  intrinsicRole: "hero_image",
                  kind: "image",
                  name: "Campaign still",
                  url: project.posterUrl,
                  expiresAt: null,
                }]
              : [],
        });
      },
    );

    await page.goto(`/create/asset?projectId=${project.id}&runId=run_terminal`);
    await expect(
      page.getByRole("heading", { name: "The studio hit a snag" }),
    ).toBeVisible();
    await expect(page.getByTestId("studio-crew")).not.toHaveAttribute(
      "data-active",
    );
    await expect(page.getByTestId("creation-progress-track")).toHaveCount(0);
    const idleFrame = await page
      .locator('[data-crew-member="director"]')
      .locator("div")
      .evaluate((sprite) => getComputedStyle(sprite).backgroundPositionX);
    expect(idleFrame).toBe("0px");
    await expect(page.getByText("This page updates automatically.")).toHaveCount(
      0,
    );
    await expect(page.getByLabel("View full request brief")).toHaveCount(0);

    status = "canceled";
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Creation stopped" }),
    ).toBeVisible();
    await expect(page.getByText("This page updates automatically.")).toHaveCount(
      0,
    );

    status = "blocked";
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "The studio needs a decision" }),
    ).toBeVisible();
    await expect(
      page.getByText("Choose between the warm and monochrome directions."),
    ).toBeVisible();
    await expect(page.getByText("This page updates automatically.")).toHaveCount(
      0,
    );

    status = "question";
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "The studio has a question" }),
    ).toBeVisible();
    await expect(
      page.getByText("Should the poster feel playful or ominous?"),
    ).toBeVisible();
    await expect(page.getByText("This page updates automatically.")).toHaveCount(
      0,
    );

    status = "succeeded";
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Your asset is ready" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open project assets" }),
    ).toBeVisible();
    await expect(page.getByText("1 asset is ready.")).toBeVisible();
    await expect(page.getByRole("img", { name: "Campaign still" })).toBeVisible();
    await expect(page.getByTestId("creation-progress-track")).toHaveCount(0);
  });

  test("shows saved media when final run wrap-up fails @mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let kind: "image" | "video" | "audio" = "image";
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/run_recovered`,
      (route) =>
        fulfillJson(route, {
          sessionId: "session_recovered",
          run: {
            id: "run_recovered",
            status: "failed",
            inputSummary: longRunSummary,
          },
          report: null,
          outputs: [{
            assetId: `asset_${kind}`,
            intrinsicRole: `standalone_${kind}`,
            kind,
            name: `Recovered ${kind}`,
            expiresAt: null,
            ...(kind === "image"
              ? { url: project.posterUrl }
              : kind === "video"
                ? { url: "https://media.example/recovered.mp4" }
                : { url: "https://media.example/recovered.mp3" }),
          }],
        }),
    );

    await page.goto(`/create/asset?projectId=${project.id}&runId=run_recovered`);
    await expect(
      page.getByRole("heading", { name: "Your asset was saved" }),
    ).toBeVisible();
    await expect(page.getByText("Asset saved", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "Recovered image" })).toBeVisible();
    await expect(page.getByText("Your result is safe")).toBeVisible();
    await expect(
      page.getByText(/couldn’t complete its final wrap-up/),
    ).toBeVisible();
    await expect(page.getByTestId("studio-crew")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Open project assets" }),
    ).toBeVisible();
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);

    kind = "video";
    await page.reload();
    await expect(
      page.getByLabel("Recovered video video", { exact: true }),
    ).toBeVisible();

    kind = "audio";
    await page.reload();
    await expect(
      page.getByLabel("Recovered audio audio", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Recovered audio", { exact: true })).toBeVisible();
  });

  test("refreshes terminal recovered media before its signed URL expires", async ({
    page,
  }) => {
    let meSupplied = false;
    let mediaRequestedAfterMe = false;
    await page.route("**/api/v1/me", (route) => {
      meSupplied = true;
      return fulfillJson(route, {
        actor: { id: "local_dev", type: "local", email: "local@popcornready.test" },
        workspaceId,
        workspaceName: "E2E Local Workspace",
        authMode: "local",
        isLocal: true,
      });
    });
    await page.route(
      `**/api/v1/assets/asset_expiring/media`,
      (route) => {
        mediaRequestedAfterMe = meSupplied;
        return fulfillJson(route, {
          url: refreshedPosterUrl,
          thumbnailUrl: refreshedPosterUrl,
          expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        });
      },
    );
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/run_expiring`,
      (route) =>
        fulfillJson(route, {
          sessionId: "session_expiring",
          run: { id: "run_expiring", status: "failed" },
          report: null,
          outputs: [{
            assetId: "asset_expiring",
            intrinsicRole: "standalone_image",
            kind: "image",
            name: "Recovered expiring image",
            url: project.posterUrl,
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }],
        }),
    );

    await page.goto(`/create/asset?projectId=${project.id}&runId=run_expiring`);
    const image = page.getByRole("img", { name: "Recovered expiring image" });
    await expect(image).toHaveAttribute("src", refreshedPosterUrl);
    expect(mediaRequestedAfterMe).toBe(true);
  });

  test("recovers terminal media after the signed URL fails to load", async ({
    page,
  }) => {
    const brokenUrl = "https://media.example/broken-recovered.png";
    let mediaRefreshes = 0;
    await page.route(brokenUrl, (route) =>
      route.fulfill({ status: 404, contentType: "image/png", body: "" }),
    );
    await page.route(
      `**/api/v1/assets/asset_broken/media`,
      (route) => {
        mediaRefreshes += 1;
        return fulfillJson(route, {
          url: refreshedPosterUrl,
          thumbnailUrl: refreshedPosterUrl,
          expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        });
      },
    );
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/run_broken`,
      (route) =>
        fulfillJson(route, {
          sessionId: "session_broken",
          run: { id: "run_broken", status: "failed" },
          report: null,
          outputs: [{
            assetId: "asset_broken",
            intrinsicRole: "standalone_image",
            kind: "image",
            name: "Recovered after load error",
            url: brokenUrl,
            expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
          }],
        }),
    );

    await page.goto(`/create/asset?projectId=${project.id}&runId=run_broken`);
    await expect(
      page.getByRole("img", { name: "Recovered after load error" }),
    ).toHaveAttribute("src", refreshedPosterUrl);
    expect(mediaRefreshes).toBeGreaterThan(0);
  });

  test("keeps polling while a generated asset is ready and the run is finishing", async ({
    page,
  }) => {
    let requestCount = 0;
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/run_finishing`,
      (route) => {
        requestCount += 1;
        return fulfillJson(route, {
          sessionId: "session_finishing",
          run: {
            id: "run_finishing",
            status: "running",
          },
          report: null,
          outputs: [{
            assetId: "asset_finishing",
            intrinsicRole: "standalone_image",
            kind: "image",
            name: "Finished frame",
            url: project.posterUrl,
            expiresAt: null,
          }],
        });
      },
    );

    await page.goto(`/create/asset?projectId=${project.id}&runId=run_finishing`);
    await expect(page.getByText("Finishing up", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "Finished frame" })).toBeVisible();
    await expect(page.getByTestId("creation-progress-track")).toBeVisible();
    await expect.poll(() => requestCount).toBeGreaterThan(1);
  });

  test("keeps the active crew calm and contained on mobile with reduced motion", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route(
      `**/api/v1/projects/${project.id}/agent-creations/run_mobile`,
      (route) =>
        fulfillJson(route, {
          sessionId: "session_mobile",
          run: {
            id: "run_mobile",
            status: "running",
            inputSummary: longRunSummary,
          },
          report: null,
          outputs: [],
        }),
    );

    await page.goto(`/create/asset?projectId=${project.id}&runId=run_mobile`);
    await expect(page.getByText("In progress", { exact: true })).toBeVisible();
    const spriteAnimation = await page
      .locator('[data-crew-member="director"]')
      .locator("div")
      .evaluate((sprite) => getComputedStyle(sprite).animationName);
    expect(spriteAnimation).toBe("none");
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);

    await page.setViewportSize({ width: 320, height: 800 });
    const narrowBounds = await page.evaluate(() => {
      const scene = document.querySelector<HTMLElement>("[data-testid='studio-crew']");
      if (!scene) throw new Error("Studio crew scene is missing");
      const sceneBox = scene.getBoundingClientRect();
      return {
        scene: { left: sceneBox.left, right: sceneBox.right },
        actors: Array.from(
          document.querySelectorAll<HTMLElement>("[data-crew-member]"),
        ).map((actor) => {
          const box = actor.getBoundingClientRect();
          return { left: box.left, right: box.right };
        }),
      };
    });
    for (const actor of narrowBounds.actors) {
      expect(actor.left).toBeGreaterThanOrEqual(narrowBounds.scene.left - 1);
      expect(actor.right).toBeLessThanOrEqual(narrowBounds.scene.right + 1);
    }
  });

});
