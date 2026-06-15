import assert from "node:assert/strict";
import test from "node:test";

import type {
  OrchestratorRun,
  RunActionSummary,
} from "@/lib/api/v1/orchestrator-store";
import { assembleOrchestratorPayloadFromParts } from "../orchestrator-run-payload";

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
  const payload = assembleOrchestratorPayloadFromParts(
    runFixture(),
    [
      actionFixture("create_or_load_brief", { outputAssetIds: ["brief_asset"] }),
      actionFixture("plan_shots", { outputAssetIds: ["plan_asset"] }),
      actionFixture("generate_storyboard", { outputAssetIds: ["storyboard_asset"] }),
    ],
    []
  );

  assert.equal(payload.run.status, "running");
  assert.equal(payload.run.currentStageType, "storyboard");
  assert.match(payload.run.message ?? "", /no video export is ready/i);
  assert.equal(payload.stages.find((stage) => stage.type === "ready")?.status, "queued");
  assert.deepEqual(payload.resultArtifacts, []);
});

test("surfaces orchestrator success as ready once export_video produced output", () => {
  const payload = assembleOrchestratorPayloadFromParts(
    runFixture(),
    [
      actionFixture("assemble_timeline", { outputAssetIds: ["timeline_1"] }),
      actionFixture("export_video", { outputAssetIds: ["export_asset_1"] }),
    ],
    []
  );

  assert.equal(payload.run.status, "succeeded");
  assert.equal(payload.run.currentStageType, "ready");
  assert.equal(payload.stages.find((stage) => stage.type === "ready")?.status, "succeeded");
  assert.deepEqual(payload.resultArtifacts, [
    {
      kind: "export",
      artifactId: "export_asset_1",
      assetId: "export_asset_1",
      stageId: "orchestrator-stage-export",
    },
  ]);
});
