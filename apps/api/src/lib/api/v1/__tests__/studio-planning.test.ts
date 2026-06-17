import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../errors";
import { parseStudioPlanningPreviewRequest } from "../schemas";
import { createStudioPlanningPreview } from "../studio-planning";

function expectApiError(fn: () => unknown, code: string): ApiError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof ApiError, "expected an ApiError");
    assert.equal(err.code, code);
    return err;
  }
  throw new Error("expected the function to throw");
}

test("parseStudioPlanningPreviewRequest accepts a draft and optional ids", () => {
  const parsed = parseStudioPlanningPreviewRequest({
    workspaceId: "workspace_1",
    draftId: "draft_1",
    projectId: "project_1",
    briefDraft: {
      goal: "Explain the launch",
      format: "visual_reveal",
    },
    footageAssetIds: ["asset_1", "asset_2"],
  });

  assert.equal(parsed.workspaceId, "workspace_1");
  assert.equal(parsed.draftId, "draft_1");
  assert.equal(parsed.projectId, "project_1");
  assert.equal(parsed.briefDraft.goal, "Explain the launch");
  assert.deepEqual(parsed.footageAssetIds, ["asset_1", "asset_2"]);
});

test("parseStudioPlanningPreviewRequest rejects invalid request shapes", () => {
  const err = expectApiError(
    () =>
      parseStudioPlanningPreviewRequest({
        briefDraft: { format: "custom_story" },
        footageAssetIds: [42],
      }),
    "validation_failed"
  );

  const paths = (err.details?.fields ?? []).map((field) => field.path).sort();
  assert.deepEqual(paths, ["briefDraft.format", "footageAssetIds"].sort());
  expectApiError(() => parseStudioPlanningPreviewRequest(null), "validation_failed");
  expectApiError(
    () => parseStudioPlanningPreviewRequest({ briefDraft: "not an object" }),
    "validation_failed"
  );
});

test("createStudioPlanningPreview honors an existing story format and readies poster prompt", () => {
  const preview = createStudioPlanningPreview({
    briefDraft: {
      goal: "Show why the new workflow matters",
      format: "misconception",
      hookQuestion: "Why do rough cuts still feel slow?",
      strongestVisual: "a split screen of chaotic notes becoming a clean timeline",
      style: "direct, crisp product demo",
      audience: "founder operators",
    },
    footageAssetIds: ["asset_1"],
  });

  assert.equal(preview.storyDirection.format, "misconception");
  assert.equal(preview.storyDirection.label, "Misconception");
  assert.equal(preview.openingHook, "Why do rough cuts still feel slow?");
  assert.equal(preview.poster.status, "ready_for_background");
  assert.equal(preview.poster.backgroundReady, true);
  assert.match(preview.poster.prompt ?? "", /Story format: Misconception/);
  assert.deepEqual(preview.source.missingInputs, []);
});

test("createStudioPlanningPreview infers direction and reports poster blockers", () => {
  const preview = createStudioPlanningPreview({
    briefDraft: {
      oneBigIdea: "every edit can be a structured decision",
    },
  });

  assert.equal(preview.storyDirection.format, "animated_explainer");
  assert.equal(
    preview.openingHook,
    "What if every edit can be a structured decision?"
  );
  assert.equal(preview.poster.status, "pending_input");
  assert.equal(preview.poster.backgroundReady, false);
  assert.equal(preview.poster.prompt, null);
  assert.deepEqual(preview.source.missingInputs, [
    "briefDraft.goal",
    "strongestVisual or footageAssetIds",
  ]);
});
