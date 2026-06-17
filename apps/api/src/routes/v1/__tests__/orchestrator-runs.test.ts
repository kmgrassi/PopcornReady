import assert from "node:assert/strict";
import test from "node:test";

import type {
  OrchestratorRun,
  RunActionSummary,
} from "@/lib/api/v1/orchestrator-store";
import type { resumeOrchestratorRun } from "@/lib/orchestrator/engine";
import { projectRunDetailFromParts, resumeRunInBackground } from "../orchestrator-runs";

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
  assert.equal(payload.run.currentStageType, "ready");
  assert.deepEqual(payload.resultArtifacts, [
    {
      kind: "export",
      artifactId: "export_asset_1",
      assetId: "export_asset_1",
      stageId: "run_1:export",
    },
  ]);
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

test("keeps unresolved tool failures within a grouped stage", () => {
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

  const stage = payload.stages.find((candidate) => candidate.type === "asset_generation");
  assert.equal(stage?.status, "failed");
  assert.equal(stage?.error?.message, "Missing beat id.");
  assert.deepEqual(stage?.artifactIds, ["clip_asset_1"]);
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
