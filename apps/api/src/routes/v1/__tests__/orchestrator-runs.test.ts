import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "@/core/errors";

import type {
  OrchestratorRun,
  OrchestratorRunGate,
  RunActionSummary,
} from "@/lib/api/v1/orchestrator-store";
import { projectRunDetailFromParts } from "../orchestrator-run-projections.js";
import {
  boardRevisionGateIdsToReset,
  boardRevisionRequiresRunResume,
  boardRevisionResumePatch,
  parseBoardRevisionTarget,
  runFailedForInsufficientCredits,
  stopAfterTools,
} from "../orchestrator-runs";


function runFixture(overrides: Partial<OrchestratorRun> = {}): OrchestratorRun {
  return {
    id: "run_1",
    schemaVersion: "orchestrator_run.v1",
    projectId: "project_1",
    status: "succeeded",
    inputSummary: "make a video",
    spentUsd: 0,
    createdAt: "2026-06-15T00:00:00.000Z",
    updatedAt: "2026-06-15T00:00:01.000Z",
    ...overrides,
  };
}

function actionFixture(
  tool: string,
  overrides: Partial<RunActionSummary> = {}
): RunActionSummary {
  return {
    id: `action_${tool}`,
    tool,
    status: "applied",
    params: {},
    outputAssetIds: [],
    jobIds: [],
    createdAt: "2026-06-15T00:00:01.000Z",
    ...overrides,
  };
}

function gateFixture(
  stage: string,
  overrides: Partial<OrchestratorRunGate> = {}
): OrchestratorRunGate {
  return {
    id: `gate_${stage}`,
    orchestratorRunId: "run_1",
    stage,
    status: "reached",
    createdAt: "2026-06-15T00:00:00.000Z",
    updatedAt: "2026-06-15T00:00:03.000Z",
    ...overrides,
  };
}

test("board feedback resumes terminal runs, including failed and canceled runs", () => {
  assert.equal(boardRevisionRequiresRunResume("failed"), true);
  assert.equal(boardRevisionRequiresRunResume("canceled"), true);
  assert.equal(boardRevisionRequiresRunResume("succeeded"), true);
  assert.equal(boardRevisionRequiresRunResume("queued"), true);
  assert.equal(boardRevisionRequiresRunResume("running"), false);
  assert.equal(boardRevisionRequiresRunResume("waiting"), false);
});

test("board feedback clears terminal state and reached gates before resuming a canceled run", () => {
  const run = runFixture({
    status: "canceled",
    startedAt: "2026-06-15T00:00:01.000Z",
    completedAt: "2026-06-15T00:00:02.000Z",
    error: { message: "Previous failure" },
  });
  assert.deepEqual(boardRevisionResumePatch(run), {
    status: "running",
    startedAt: "2026-06-15T00:00:01.000Z",
    clearCompletedAt: true,
    clearError: true,
  });
  assert.deepEqual(boardRevisionGateIdsToReset(run, [gateFixture("generate_keyframe")]), [
    "gate_generate_keyframe",
  ]);
  assert.deepEqual(
    boardRevisionGateIdsToReset(runFixture({ status: "failed" }), [gateFixture("generate_keyframe")]),
    []
  );
});

test("makes an unexpected terminal success without video a terminal partial failure", () => {
  const payload = projectRunDetailFromParts(
    runFixture(),
    [],
    [
      actionFixture("create_or_load_brief", { outputAssetIds: ["brief_asset"] }),
      actionFixture("plan_shots", { outputAssetIds: ["plan_asset"] }),
      actionFixture("generate_storyboard", { outputAssetIds: ["storyboard_asset"] }),
    ]
  );

  assert.equal(payload.run.status, "failed");
  assert.equal(payload.run.currentStageType, "storyboard");
  assert.equal(payload.run.error?.code, "missing_video_output");
  assert.match(payload.run.message ?? "", /no playable video was created/i);
  assert.equal(payload.resultArtifacts?.length, 0);
});

test("prompt runs stop after storyboard unless explicitly run through", () => {
  assert.deepEqual(stopAfterTools({}), ["generate_storyboard"]);
  assert.deepEqual(stopAfterTools({ runThrough: true }), []);
  assert.deepEqual(stopAfterTools({ stopAfter: "brief_intake" }), ["create_or_load_brief"]);
});

test("surfaces orchestrator success as ready once export_video produced output", () => {
  const payload = projectRunDetailFromParts(
    runFixture(),
    [],
    [
      actionFixture("assemble_timeline", { outputAssetIds: ["timeline_1"] }),
      actionFixture("export_video", { outputAssetIds: ["export_asset_1"] }),
    ],
    new Map([
      ["export_asset_1", { status: "ready", kind: "video", hasPlayableSource: true }],
    ])
  );

  assert.equal(payload.run.status, "succeeded");
  assert.equal(payload.run.completionKind, "video");
  assert.equal(payload.run.currentStageType, "ready");
  assert.deepEqual(payload.resultArtifacts, [
    {
      kind: "export",
      purpose: "export",
      artifactId: "export_asset_1",
      assetId: "export_asset_1",
      stageId: "run_1:export",
    },
  ]);
});

test("playable export wins over an after-export stop gate", () => {
  const payload = projectRunDetailFromParts(
    runFixture(),
    [gateFixture("after:export_video")],
    [actionFixture("export_video", { outputAssetIds: ["export_asset_1"] })],
    new Map([
      ["export_asset_1", { status: "ready", kind: "video", hasPlayableSource: true }],
    ])
  );

  assert.equal(payload.run.status, "succeeded");
  assert.equal(payload.run.completionKind, "video");
  assert.match(payload.run.message ?? "", /video export is ready/i);
});

test("rejects applied exports whose output is missing or not playable", () => {
  for (const asset of [
    undefined,
    { status: "pending", kind: "video", hasPlayableSource: true },
    { status: "ready", kind: "image", hasPlayableSource: true },
    { status: "ready", kind: "video", hasPlayableSource: false },
  ]) {
    const assets = asset ? new Map([["export_asset_1", asset]]) : new Map();
    const payload = projectRunDetailFromParts(
      runFixture(),
      [],
      [actionFixture("export_video", { outputAssetIds: ["export_asset_1"] })],
      assets
    );
    assert.equal(payload.run.status, "failed");
    assert.equal(payload.run.error?.code, "missing_video_output");
  }
});

test("active work has unknown progress and reports provider waits and recovery", () => {
  const waiting = projectRunDetailFromParts(
    runFixture({ status: "waiting" }),
    [],
    [actionFixture("generate_anchor", { status: "running", jobIds: ["job_1"] })]
  );
  assert.equal(waiting.run.progressPercent, undefined);
  assert.equal(waiting.run.activityState, "waiting_on_job");
  assert.equal(waiting.run.currentToolName, "generate_anchor");

  const recovering = projectRunDetailFromParts(
    runFixture({ status: "running" }),
    [],
    [
      actionFixture("generate_clip", {
        status: "failed",
        error: { recoverable: true },
        createdAt: "2026-06-15T00:00:01.000Z",
      }),
      actionFixture("generate_storyboard", {
        status: "running",
        createdAt: "2026-06-15T00:00:02.000Z",
      }),
    ]
  );
  assert.equal(recovering.run.activityState, "recovering");
  assert.equal(recovering.run.currentToolName, "generate_storyboard");
  assert.equal(recovering.stages.find((stage) => stage.toolName === "generate_clip")?.status, "failed");

  const recovered = projectRunDetailFromParts(
    runFixture({ status: "running" }),
    [],
    [
      actionFixture("generate_clip", {
        id: "clip_failed",
        status: "failed",
        error: { recoverable: true },
        createdAt: "2026-06-15T00:00:01.000Z",
      }),
      actionFixture("generate_clip", {
        id: "clip_recovered",
        status: "applied",
        createdAt: "2026-06-15T00:00:02.000Z",
      }),
      actionFixture("export_video", {
        status: "running",
        createdAt: "2026-06-15T00:00:03.000Z",
      }),
    ]
  );
  assert.equal(recovered.run.activityState, "working");
});

test("surfaces stop-after orchestrator success as complete without a final export", () => {
  const payload = projectRunDetailFromParts(
    runFixture(),
    [gateFixture("after:generate_keyframe")],
    [
      actionFixture("create_or_load_brief", { outputAssetIds: ["brief_asset"] }),
      actionFixture("draft_script", { outputAssetIds: ["script_asset"] }),
      actionFixture("generate_keyframe", { outputAssetIds: ["keyframe_asset"] }),
    ]
  );

  assert.equal(payload.run.status, "succeeded");
  assert.equal(payload.run.completionKind, "storyboard_assets");
  assert.equal(payload.run.reviewGate, null);
  assert.deepEqual(payload.run.reviewGates, []);
  assert.equal(payload.run.currentStageType, "ready");
  assert.match(payload.run.message ?? "", /storyboard assets are ready/i);
});

test("does not claim storyboard assets for an intentional early stop", () => {
  const payload = projectRunDetailFromParts(
    runFixture(),
    [gateFixture("after:create_or_load_brief")],
    [actionFixture("create_or_load_brief", { outputAssetIds: ["brief_asset"] })]
  );

  assert.equal(payload.run.status, "succeeded");
  assert.equal(payload.run.completionKind, undefined);
  assert.match(payload.run.message ?? "", /no playable video/i);
  assert.doesNotMatch(payload.run.message ?? "", /storyboard/i);
});

test("keeps board feedback actions out of generation progress projections", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ status: "running" }),
    [],
    [
      actionFixture("generate_storyboard", { outputAssetIds: ["storyboard_asset"] }),
      actionFixture("board_feedback", {
        id: "feedback_1",
        status: "proposed",
        params: {
          message: "Make this frame moodier.",
          target: { scope: "tile", beatId: "beat_1", assetId: "storyboard_asset" },
        },
        createdAt: "2026-06-15T00:00:02.000Z",
      }),
    ]
  );

  assert.equal(payload.run.currentStageType, "storyboard");
  assert.deepEqual(
    payload.stages.map((stage) => stage.type),
    ["storyboard"]
  );
  assert.deepEqual(
    payload.stageItems.map((item) => item.assetId),
    ["storyboard_asset"]
  );
});

test("parseBoardRevisionTarget validates currentBrief with the shared brief schema", () => {
  const target = parseBoardRevisionTarget(
    {
      target: {
        scope: "brief",
        currentBrief: {
          goal: "Tighten the product launch hook.",
          targetLengthSec: 30,
          aspectRatio: "9:16",
          platform: "tiktok",
        },
      },
    },
    "run_1"
  );

  assert.equal(target.currentBrief?.goal, "Tighten the product launch hook.");
  assert.equal(target.currentBrief?.targetLengthSec, 30);
  assert.equal(target.currentBrief?.aspectRatio, "9:16");
  assert.equal(target.currentBrief?.platform, "tiktok");
});

test("parseBoardRevisionTarget rejects an invalid currentBrief payload", () => {
  assert.throws(
    () =>
      parseBoardRevisionTarget(
        {
          target: {
            scope: "brief",
            currentBrief: {
              goal: "Missing typed brief fields should fail.",
            },
          },
        },
        "run_1"
      ),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, "validation_failed");
      assert.match(err.message, /request body is invalid/i);
      return true;
    }
  );
});

test("parseBoardRevisionTarget accepts primary footage asset targets", () => {
  const target = parseBoardRevisionTarget(
    {
      target: {
        scope: "asset",
        assetId: "source_office_clip",
        targetAssetUse: "primary_footage",
        label: "Uploaded office clip",
      },
    },
    "run_1"
  );

  assert.equal(target.scope, "asset");
  assert.equal(target.assetId, "source_office_clip");
  assert.equal(target.targetAssetUse, "primary_footage");
});

test("parseBoardRevisionTarget rejects asset scope without an asset id", () => {
  assert.throws(
    () =>
      parseBoardRevisionTarget(
        {
          target: {
            scope: "asset",
            targetAssetUse: "primary_footage",
          },
        },
        "run_1"
      ),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, "validation_failed");
      assert.match(err.message, /require an asset id/i);
      return true;
    }
  );
});

test("parseBoardRevisionTarget rejects unsupported asset target uses", () => {
  assert.throws(
    () =>
      parseBoardRevisionTarget(
        {
          target: {
            scope: "asset",
            assetId: "source_office_clip",
            targetAssetUse: "banana",
          },
        },
        "run_1"
      ),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, "validation_failed");
      assert.match(err.message, /targetAssetUse/i);
      return true;
    }
  );
});

test("projects a regenerated stage from the latest action instead of stale failures", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ status: "waiting" }),
    [
      {
        id: "gate_1",
        orchestratorRunId: "run_1",
        stage: "create_or_load_brief",
        status: "reached",
        createdAt: "2026-06-15T00:00:00.000Z",
        updatedAt: "2026-06-15T00:00:03.000Z",
      },
    ],
    [
      actionFixture("create_or_load_brief", {
        id: "failed_brief",
        status: "failed",
        error: { kind: "invalid_input", message: "The request body is invalid.", recoverable: true },
        createdAt: "2026-06-15T00:00:01.000Z",
      }),
      actionFixture("create_or_load_brief", {
        id: "applied_brief",
        status: "applied",
        outputAssetIds: ["brief_asset_2"],
        createdAt: "2026-06-15T00:00:02.000Z",
      }),
    ]
  );

  assert.equal(payload.run.status, "running");
  assert.equal(payload.run.reviewGate?.stageType, "brief_intake");
  assert.equal(payload.stages[0]?.status, "succeeded");
  assert.equal(payload.stages[0]?.error, undefined);
  assert.deepEqual(payload.stages[0]?.artifactIds, ["brief_asset_2"]);
});

test("projects a reached dynamic approval gate as a resolvable review gate", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ status: "waiting" }),
    [
      {
        id: "gate_export_video",
        orchestratorRunId: "run_1",
        stage: "export_video",
        status: "reached",
        createdAt: "2026-06-15T00:00:00.000Z",
        updatedAt: "2026-06-15T00:00:03.000Z",
      },
    ],
    [actionFixture("request_approval", { status: "running", outputAssetIds: ["preview_1"] })]
  );

  assert.equal(payload.run.reviewGate?.stageType, "export");
  assert.equal(payload.run.reviewGate?.state, "awaiting_review");
  assert.equal(payload.run.currentStageType, "export");
  const qualityStage = payload.stages.find((stage) => stage.type === "quality_review");
  assert.deepEqual(qualityStage?.artifactIds, ["preview_1"]);
});

test("keeps sibling tool statuses separate within a broad stage", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ status: "running" }),
    [],
    [
      actionFixture("generate_keyframe", {
        id: "failed_keyframe",
        status: "failed",
        error: {
          kind: "invalid_input",
          message: "Missing beat id.",
          recoverable: true,
        },
        createdAt: "2026-06-15T00:00:01.000Z",
      }),
      actionFixture("generate_clip", {
        id: "applied_clip",
        status: "applied",
        outputAssetIds: ["clip_asset_1"],
        createdAt: "2026-06-15T00:00:02.000Z",
      }),
    ]
  );

  const keyframeStage = payload.stages.find(
    (candidate) => candidate.toolName === "generate_keyframe"
  );
  const clipStage = payload.stages.find((candidate) => candidate.toolName === "generate_clip");
  assert.equal(keyframeStage?.status, "failed");
  assert.equal(keyframeStage?.error?.message, "Missing beat id.");
  assert.deepEqual(keyframeStage?.artifactIds, []);
  assert.equal(clipStage?.status, "succeeded");
  assert.deepEqual(clipStage?.artifactIds, ["clip_asset_1"]);
});

test("projects stage item purpose metadata from orchestrator tools", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ status: "running" }),
    [],
    [
      actionFixture("generate_storyboard", {
        id: "storyboard_action",
        outputAssetIds: ["storyboard_asset_1"],
      }),
      actionFixture("generate_keyframe", {
        id: "keyframe_action",
        outputAssetIds: ["keyframe_asset_1"],
      }),
      actionFixture("generate_clip", {
        id: "clip_action",
        outputAssetIds: ["clip_asset_1"],
      }),
      actionFixture("generate_audio", {
        id: "audio_action",
        outputAssetIds: ["audio_asset_1"],
      }),
      actionFixture("fit_audio_to_picture", {
        id: "audio_fit_action",
        outputAssetIds: ["audio_fit_critique_1"],
      }),
      actionFixture("assemble_timeline", {
        id: "timeline_action",
        outputAssetIds: ["timeline_asset_1"],
      }),
    ]
  );

  assert.deepEqual(
    payload.stageItems.map((item) => ({
      kind: item.kind,
      purpose: item.purpose,
      assetId: item.assetId,
    })),
    [
      { kind: "image", purpose: "storyboard_frame", assetId: "storyboard_asset_1" },
      { kind: "image", purpose: "keyframe", assetId: "keyframe_asset_1" },
      { kind: "video", purpose: "shot", assetId: "clip_asset_1" },
      { kind: "audio", purpose: "audio", assetId: "audio_asset_1" },
      { kind: "audio", purpose: "audio", assetId: "audio_fit_critique_1" },
      { kind: "timeline", purpose: "timeline", assetId: "timeline_asset_1" },
    ]
  );
});

test("projects audio fit actions into the audio generation stage", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ status: "running" }),
    [],
    [
      actionFixture("fit_audio_to_picture", {
        id: "audio_fit_action",
        outputAssetIds: ["audio_fit_critique_1"],
      }),
    ]
  );

  const audioStage = payload.stages.find(
    (candidate) => candidate.toolName === "fit_audio_to_picture"
  );
  assert.equal(audioStage?.type, "audio_generation");
  assert.deepEqual(audioStage?.artifactIds, ["audio_fit_critique_1"]);
});

test("projects video edit actions as video asset-generation stage items", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ status: "waiting" }),
    [],
    [
      actionFixture("edit_video_asset", {
        id: "edit_action",
        status: "running",
        params: { prompt: "Add a dinosaur sitting on the couch." },
        outputAssetIds: ["edited_clip_asset"],
        jobIds: ["job_edit_1"],
      }),
    ]
  );

  assert.deepEqual(
    payload.stages.map((stage) => ({
      type: stage.type,
      label: stage.label,
      status: stage.status,
      artifactIds: stage.artifactIds,
      jobIds: stage.jobIds,
    })),
    [
      {
        type: "asset_generation",
        label: "Video Edits",
        status: "running",
        artifactIds: ["edited_clip_asset"],
        jobIds: ["job_edit_1"],
      },
    ]
  );
  assert.deepEqual(
    payload.stageItems.map((item) => ({
      kind: item.kind,
      purpose: item.purpose,
      promptPreview: item.promptPreview,
      assetId: item.assetId,
    })),
    [
      {
        kind: "video",
        purpose: "shot",
        promptPreview: "Add a dinosaur sitting on the couch.",
        assetId: "edited_clip_asset",
      },
    ]
  );
});

test("projects data-only tool outputs as non-visual stage items", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ status: "running" }),
    [],
    [
      actionFixture("create_or_load_brief", { outputAssetIds: ["brief_asset"] }),
      actionFixture("develop_story_blueprint", { outputAssetIds: ["blueprint_asset"] }),
      actionFixture("draft_script", { outputAssetIds: ["script_asset"] }),
      actionFixture("plan_shots", { outputAssetIds: ["plan_asset"] }),
      actionFixture("plan_visual_anchors", { outputAssetIds: ["anchor_plan_asset"] }),
    ]
  );

  assert.deepEqual(
    payload.stageItems.map((item) => ({
      kind: item.kind,
      purpose: item.purpose,
      assetId: item.assetId,
    })),
    [
      { kind: "caption", purpose: "brief", assetId: "brief_asset" },
      { kind: "caption", purpose: "plan", assetId: "blueprint_asset" },
      { kind: "caption", purpose: "plan", assetId: "script_asset" },
      { kind: "caption", purpose: "plan", assetId: "plan_asset" },
      { kind: "caption", purpose: "plan", assetId: "anchor_plan_asset" },
    ]
  );
});

test("keeps request approval preview artifacts visible", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ status: "waiting" }),
    [gateFixture("request_approval")],
    [
      actionFixture("request_approval", {
        id: "approval_action",
        status: "running",
        outputAssetIds: ["preview_asset_1"],
      }),
    ]
  );

  assert.deepEqual(
    payload.stageItems.map((item) => ({
      kind: item.kind,
      purpose: item.purpose,
      assetId: item.assetId,
    })),
    [{ kind: "image", purpose: "quality_review", assetId: "preview_asset_1" }]
  );
});

test("projects full action prompts into stage items", () => {
  const longPrompt = `${"cinematic ".repeat(40)}final frame`;
  const payload = projectRunDetailFromParts(
    runFixture({ status: "running" }),
    [],
    [
      actionFixture("generate_keyframe", {
        params: { prompt: longPrompt },
        outputAssetIds: ["keyframe_asset_1"],
      }),
    ]
  );

  assert.equal(payload.stageItems[0]?.prompt, longPrompt);
  assert.ok(payload.stageItems[0]?.promptPreview);
  assert.notEqual(payload.stageItems[0]?.promptPreview, longPrompt);
  assert.match(payload.stageItems[0]?.promptPreview ?? "", /…$/);
});

test("credit recovery accepts run-level insufficient-credit failures without a failed action", () => {
  assert.equal(
    runFailedForInsufficientCredits(
      runFixture({
        status: "failed",
        error: { kind: "insufficient_credits", message: "Ran out of credits mid-run." },
      })
    ),
    true
  );
  assert.equal(
    runFailedForInsufficientCredits(
      runFixture({
        status: "failed",
        error: { kind: "provider_failed", message: "Provider quota failure." },
      })
    ),
    false
  );
  assert.equal(
    runFailedForInsufficientCredits(
      runFixture({
        status: "running",
        error: { kind: "insufficient_credits", message: "Still running." },
      })
    ),
    false
  );
});

test("backfills stage item prompts from linked asset metadata", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ status: "running" }),
    [],
    [
      actionFixture("generate_anchor", {
        outputAssetIds: ["anchor_with_prompt", "anchor_with_description"],
      }),
    ],
    new Map([
      ["anchor_with_prompt", { prompt: "A reusable neon bakery exterior at midnight." }],
      [
        "anchor_with_description",
        { description: "A close character reference for the midnight baker." },
      ],
    ])
  );

  assert.deepEqual(
    payload.stageItems.map((item) => item.prompt),
    [
      "A reusable neon bakery exterior at midnight.",
      "A close character reference for the midnight baker.",
    ]
  );
});

test("keeps an explicit action prompt ahead of linked asset metadata", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ status: "running" }),
    [],
    [
      actionFixture("generate_keyframe", {
        params: { prompt: "The prompt submitted for this action." },
        outputAssetIds: ["keyframe_asset"],
      }),
    ],
    new Map([
      ["keyframe_asset", { prompt: "A different persisted provider prompt." }],
    ])
  );

  assert.equal(payload.stageItems[0]?.prompt, "The prompt submitted for this action.");
});
