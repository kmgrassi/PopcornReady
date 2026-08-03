import { expect, test, type Page } from "@playwright/test";
import {
  mockAssetStudioProject,
  fulfillJson,
  project,
  longRunSummary,
} from "./fixtures/asset-studio";
import { mockLocalApi } from "./fixtures/local-api";

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
              ? [{ assetId: "asset_ready", intrinsicRole: "hero_image" }]
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
    await expect(page.getByTestId("creation-progress-track")).toHaveCount(0);
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
