import assert from "node:assert/strict";
import test from "node:test";
import type { LlmClient, StructuredArgs } from "@popcorn/llm";
import { ApiError } from "../errors";
import { parseStudioPlanningPreviewRequest } from "../schemas";
import {
  createStudioPlanningPreview,
  createStudioPlanningStory,
} from "../studio-planning";

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
  assert.deepEqual(preview.beats, [
    {
      id: "beat_hook",
      label: "Assumption",
      text: "Why do rough cuts still feel slow?",
      role: "hook",
    },
    {
      id: "beat_evidence",
      label: "Evidence",
      text: "Use a split screen of chaotic notes becoming a clean timeline as the visual proof point.",
    },
    {
      id: "beat_reframe",
      label: "Reframe",
      text: "Open on the common wrong assumption, then replace it with the useful takeaway.",
    },
    {
      id: "beat_payoff",
      label: "Takeaway",
      text: "Resolve the video back to Show why the new workflow matters.",
      role: "payoff",
    },
  ]);
  assert.equal(preview.poster.status, "ready_for_background");
  assert.equal(preview.poster.backgroundReady, true);
  assert.match(preview.poster.prompt ?? "", /Story format: Misconception/);
  assert.deepEqual(preview.source.missingInputs, []);
});

test("createStudioPlanningPreview reads persisted Studio draft aliases", () => {
  const preview = createStudioPlanningPreview({
    briefDraft: {
      goal: "Explain correlation and causation for beginners",
      hook: "Why do ice cream sales rise when more people swim?",
      bestVisual: "two side-by-side charts moving together",
      bigIdea: "moving together does not prove one thing caused the other",
      format: "classroom_demo",
    },
  });

  assert.equal(preview.storyDirection.format, "classroom_demo");
  assert.equal(
    preview.openingHook,
    "Why do ice cream sales rise when more people swim?"
  );
  assert.equal(preview.beats[0]?.id, "beat_hook");
  assert.equal(preview.beats[0]?.role, "hook");
  assert.equal(preview.beats.at(-1)?.role, "payoff");
  assert.equal(preview.poster.status, "ready_for_background");
  assert.match(preview.poster.prompt ?? "", /two side-by-side charts/);
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
  assert.deepEqual(
    preview.beats.map((beat) => beat.label),
    ["Idea", "Context", "Model", "Example", "Payoff"]
  );
  assert.equal(
    preview.beats.find((beat) => beat.label === "Example")?.text,
    "Generate visuals that make this idea concrete: every edit can be a structured decision."
  );
  assert.equal(preview.poster.status, "pending_input");
  assert.equal(preview.poster.backgroundReady, false);
  assert.equal(preview.poster.prompt, null);
  assert.deepEqual(preview.source.missingInputs, [
    "briefDraft.goal",
    "strongestVisual or footageAssetIds",
  ]);
});

test("createStudioPlanningStory asks the model for only a one-sentence story", async () => {
  const structuredCalls: StructuredArgs[] = [];
  const llm: LlmClient = {
    provider: "openai",
    model: "test-model",
    modelFor: () => "test-model",
    async structured<T>(args: StructuredArgs): Promise<T> {
      structuredCalls.push(args);
      return {
        story:
          "Story: A courier races across a flooded city to deliver the final battery that keeps a neighborhood's lights alive. Shot list: open wide.",
      } as T;
    },
    async structuredVision<T>(): Promise<T> {
      throw new Error("not used");
    },
    async chooseTool() {
      throw new Error("not used");
    },
  };

  const response = await createStudioPlanningStory(
    {
      briefDraft: {
        goal: "Make a short film about a courier saving a neighborhood blackout",
        hook: "What happens when the last battery is across town?",
        bestVisual: "a bike cutting through rain and neon reflections",
        payoff: "the block lights up together",
      },
    },
    { llm }
  );

  assert.equal(
    response.story,
    "A courier races across a flooded city to deliver the final battery that keeps a neighborhood's lights alive."
  );
  const structuredArgs = structuredCalls[0];
  assert.ok(structuredArgs);
  assert.equal(structuredArgs.effort, "minimal");
  assert.match(structuredArgs.cachedSystem, /Return only the requested story sentence/);
  assert.match(structuredArgs.user, /deterministicStory/);
  assert.match(structuredArgs.user, /movie plot\/story/);
});
