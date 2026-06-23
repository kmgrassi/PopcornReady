import assert from "node:assert/strict";
import test from "node:test";

import type {
  OrchestratorRun,
  OrchestratorRunGate,
  RunActionSummary,
} from "@/lib/api/v1/orchestrator-store";
import type { resumeOrchestratorRun } from "@/lib/orchestrator/engine";
import { projectRunDetailFromParts } from "../orchestrator-run-projections.js";
import { resumeRunInBackground } from "../orchestrator-runs";

type Resume = typeof resumeOrchestratorRun;

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

test("does not surface a storyboard-only orchestrator success as a ready video", () => {
  const payload = projectRunDetailFromParts(
    runFixture(),
    [],
    [
      actionFixture("create_or_load_brief", { outputAssetIds: ["brief_asset"] }),
      actionFixture("plan_shots", { outputAssetIds: ["plan_asset"] }),
      actionFixture("generate_storyboard", { outputAssetIds: ["storyboard_asset"] }),
    ]
  );

  assert.equal(payload.run.status, "running");
  assert.equal(payload.run.currentStageType, "storyboard");
  assert.match(payload.run.message ?? "", /no video export is ready/i);
  assert.equal(payload.resultArtifacts?.length, 0);
});

test("surfaces orchestrator success as ready once export_video produced output", () => {
  const payload = projectRunDetailFromParts(
    runFixture(),
    [],
    [
      actionFixture("assemble_timeline", { outputAssetIds: ["timeline_1"] }),
      actionFixture("export_video", { outputAssetIds: ["export_asset_1"] }),
    ]
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
      { kind: "timeline", purpose: "timeline", assetId: "timeline_asset_1" },
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

test("resumeRunInBackground starts resume and returns before it settles", async () => {
  let resolveResume: (() => void) | undefined;
  let resumeStarted = false;
  let resumeSettled = false;
  const resume: Resume = async (_runId, deps) => {
    resumeStarted = true;
    assert.equal(deps.workspaceId, "ws1");
    assert.equal(deps.agentId, "orchestrator");
    await new Promise<void>((resolve) => {
      resolveResume = resolve;
    });
    resumeSettled = true;
    return {
      id: "run1",
      schemaVersion: "orchestrator_run.v1",
      projectId: "proj1",
      status: "succeeded",
      inputSummary: "done",
      spentUsd: 0,
      createdAt: "t0",
      updatedAt: "t1",
    };
  };

  resumeRunInBackground("ws1", "run1", resume);

  assert.equal(resumeStarted, true);
  assert.equal(resumeSettled, false, "caller must not wait for resume completion");
  resolveResume?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resumeSettled, true);
});

test("resumeRunInBackground logs background resume failures", async () => {
  const error = new Error("model timeout");
  const logged: unknown[][] = [];
  const resume: Resume = async () => {
    throw error;
  };

  resumeRunInBackground("ws1", "run1", resume, (...args: unknown[]) => {
    logged.push(args);
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(logged.length, 1);
  assert.equal(logged[0][0], "orchestrator resume failed");
  assert.equal(logged[0][1], error);
});
