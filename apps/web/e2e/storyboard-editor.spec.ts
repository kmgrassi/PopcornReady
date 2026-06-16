import { expect, test, type Page } from "@playwright/test";
import type {
  ProjectStoryboard,
  StoryboardBeat,
  StoryboardScene,
} from "@popcorn/shared/v1/types";

const projectId = "project_storyboard_e2e";
const now = "2026-06-16T14:00:00.000Z";

type SaveStoryboardPayload = {
  id?: string;
  status?: ProjectStoryboard["status"];
  scenes: Array<{
    id: string;
    title: string | null;
    summary?: string | null;
    setting?: string | null;
    mood?: string | null;
    durationSec?: number | null;
    status?: StoryboardScene["status"];
    beats: Array<{
      id: string;
      intent: string;
      visualDescription?: string | null;
      dialogueSummary?: string | null;
      narration?: string | null;
      durationSec?: number | null;
      status?: StoryboardBeat["status"];
    }>;
  }>;
};

function beat(
  input: Partial<StoryboardBeat> & Pick<StoryboardBeat, "id" | "sceneId" | "intent">,
): StoryboardBeat {
  return {
    projectId,
    beatIndex: 0,
    visualDescription: null,
    dialogueSummary: null,
    narration: null,
    durationSec: 3,
    status: "draft",
    beatAssetId: null,
    panels: [],
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

function scene(
  input: Partial<StoryboardScene> & Pick<StoryboardScene, "id" | "title">,
): StoryboardScene {
  return {
    projectId,
    storyboardId: "storyboard_e2e",
    sceneIndex: 0,
    summary: null,
    setting: null,
    mood: null,
    durationSec: null,
    sceneAssetId: null,
    status: "draft",
    beats: [],
    createdAt: now,
    updatedAt: now,
    ...input,
  };
}

function storyboard(scenes: StoryboardScene[]): ProjectStoryboard {
  return {
    id: "storyboard_e2e",
    projectId,
    planAssetId: null,
    status: "draft",
    scenes,
    createdAt: now,
    updatedAt: now,
  };
}

async function installStoryboardFixture(page: Page) {
  let savedStoryboard = storyboard([
    scene({
      id: "scene_1",
      title: "Launch day",
      setting: "Kitchen table",
      mood: "Focused",
      beats: [
        beat({
          id: "beat_1",
          sceneId: "scene_1",
          intent: "Show the team reviewing the launch checklist",
          visualDescription: "Laptop with timeline cards open",
          dialogueSummary: "We are ready to ship.",
          narration: "The team lines up the final moments before launch.",
          durationSec: 4,
        }),
      ],
    }),
  ]);

  await page.route("**/api/v1/me", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        actor: { id: "local-user", type: "local", email: "local@example.test" },
        workspaceId: "workspace_storyboard_e2e",
        workspaceName: "E2E Workspace",
        authMode: "local",
        isLocal: true,
      }),
    });
  });

  await page.route(`**/api/v1/projects/${projectId}/storyboard`, async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ storyboard: savedStoryboard }),
      });
      return;
    }

    if (request.method() === "PUT") {
      const payload = request.postDataJSON() as SaveStoryboardPayload;

      savedStoryboard = storyboard(
        payload.scenes.map((inputScene, sceneIndex) =>
          scene({
            id: inputScene.id,
            title: inputScene.title,
            sceneIndex,
            summary: inputScene.summary ?? null,
            setting: inputScene.setting ?? null,
            mood: inputScene.mood ?? null,
            durationSec: inputScene.durationSec ?? null,
            status: inputScene.status ?? "draft",
            beats: inputScene.beats.map((inputBeat, beatIndex) =>
              beat({
                id: inputBeat.id,
                sceneId: inputScene.id,
                beatIndex,
                intent: inputBeat.intent,
                visualDescription: inputBeat.visualDescription ?? null,
                dialogueSummary: inputBeat.dialogueSummary ?? null,
                narration: inputBeat.narration ?? null,
                durationSec: inputBeat.durationSec ?? null,
                status: inputBeat.status ?? "draft",
              }),
            ),
          }),
        ),
      );

      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ storyboard: savedStoryboard }),
      });
      return;
    }

    await route.fallback();
  });
}

test("storyboard editor saves scene and beat edits and reloads persisted data", async ({ page }) => {
  await installStoryboardFixture(page);

  await page.goto(`/projects/${projectId}/storyboard`);
  await expect(page.getByRole("heading", { name: "Storyboard" })).toBeVisible();

  const firstScene = page.locator(".sb-scene").first();
  await expect(firstScene.getByLabel("Scene name")).toHaveValue("Launch day");

  await firstScene.getByLabel("Scene name").fill("Opening launch standup");
  await firstScene.getByLabel("Setting").fill("Studio bullpen");
  await firstScene.getByLabel("Mood").fill("Urgent but calm");
  await firstScene.getByLabel("Intent").fill("Open on the team checking the release board");
  await firstScene.getByLabel("Seconds").fill("6");
  await firstScene
    .getByLabel("Visual description")
    .fill("A kanban board fills the wall behind two producers.");
  await firstScene.getByLabel("Narration").fill("The launch plan comes into focus.");
  await firstScene.getByRole("button", { name: "Add beat" }).click();
  await firstScene
    .locator(".sb-beat")
    .nth(1)
    .getByLabel("Intent")
    .fill("Cut to the release owner calling the first checkpoint");

  await page.getByRole("button", { name: "Add scene" }).click();
  const secondScene = page.locator(".sb-scene").nth(1);
  await secondScene.getByLabel("Scene name").fill("Audience preview");
  await secondScene.getByLabel("Setting").fill("Screening room");
  await secondScene.getByLabel("Intent").fill("Show first viewers reacting to the finished cut");
  await firstScene.locator(".sb-beat").nth(1).getByRole("button", { name: "Scene ↓" }).click();
  await secondScene.locator(".sb-beat").first().getByRole("button", { name: "Remove" }).click();

  await expect(page.getByText("Unsaved changes")).toBeVisible();

  const saveRequest = page.waitForRequest((request) => {
    return (
      request.method() === "PUT" &&
      request.url().endsWith(`/api/v1/projects/${projectId}/storyboard`)
    );
  });
  await page.getByRole("button", { name: "Save storyboard" }).click();
  const request = await saveRequest;
  const savedPayload = request.postDataJSON() as SaveStoryboardPayload;
  expect(savedPayload.scenes).toHaveLength(2);
  expect(savedPayload.scenes[0].title).toBe("Opening launch standup");
  expect(savedPayload.scenes[0].setting).toBe("Studio bullpen");
  expect(savedPayload.scenes[0].beats[0].intent).toBe("Open on the team checking the release board");
  expect(savedPayload.scenes[1].title).toBe("Audience preview");
  expect(savedPayload.scenes[1].beats).toHaveLength(1);
  expect(savedPayload.scenes[1].beats[0].intent).toBe("Cut to the release owner calling the first checkpoint");

  await expect(page.getByText("Saved")).toBeVisible();

  await page.reload();
  await expect(page.locator(".sb-scene")).toHaveCount(2);
  await expect(page.locator(".sb-scene").first().getByLabel("Scene name")).toHaveValue(
    "Opening launch standup",
  );
  await expect(page.locator(".sb-scene").first().getByLabel("Narration")).toHaveValue(
    "The launch plan comes into focus.",
  );
  await expect(page.locator(".sb-scene").nth(1).getByLabel("Scene name")).toHaveValue(
    "Audience preview",
  );
  await expect(page.locator(".sb-scene").nth(1).locator(".sb-beat")).toHaveCount(1);
  await expect(page.locator(".sb-scene").nth(1).getByLabel("Intent")).toHaveValue(
    "Cut to the release owner calling the first checkpoint",
  );
});
