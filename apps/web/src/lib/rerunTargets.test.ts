import assert from "node:assert/strict";
import test from "node:test";
import type { BoardRevisionTarget } from "@popcorn/shared/v1/types";
import {
  boardRevisionTargetToRerunTarget,
  cutSelectionRerunTarget,
  resolveRerunTarget,
} from "./rerunTargets";

const projectId = "project-1";

test("maps exact asset graph targets without broadening", () => {
  const cases: Array<[BoardRevisionTarget, Record<string, string>]> = [
    [
      { scope: "asset", assetId: "asset-1" },
      { kind: "asset", projectId, assetId: "asset-1" },
    ],
    [
      { scope: "tile", clipAssetId: "clip-1", beatId: "beat-1" },
      { kind: "asset", projectId, assetId: "clip-1" },
    ],
    [
      { scope: "tile", keyframeAssetId: "frame-1", panelId: "panel-1" },
      { kind: "asset", projectId, assetId: "frame-1" },
    ],
    [
      { scope: "tile", panelId: "panel-1", beatId: "beat-1" },
      { kind: "panel", projectId, panelId: "panel-1" },
    ],
    [
      { scope: "tile", beatId: "beat-1", sceneId: "scene-1" },
      { kind: "beat", projectId, beatId: "beat-1" },
    ],
    [
      { scope: "board", sceneId: "scene-1", storyboardId: "board-1" },
      { kind: "scene", projectId, sceneId: "scene-1" },
    ],
    [
      { scope: "board", storyboardId: "board-1" },
      { kind: "storyboard", projectId, storyboardId: "board-1" },
    ],
  ];

  for (const [legacy, expected] of cases) {
    assert.deepEqual(
      boardRevisionTargetToRerunTarget(projectId, legacy),
      expected
    );
  }
});

test("targets the active cut through its exact project selection", () => {
  const cutTarget = {
    kind: "selection",
    projectId,
    slotOwnerLineageId: null,
    slotRole: "cut",
  } as const;
  assert.deepEqual(cutSelectionRerunTarget(projectId), cutTarget);
  assert.deepEqual(
    resolveRerunTarget(
      projectId,
      { scope: "concept" },
      cutSelectionRerunTarget(projectId)
    ),
    cutTarget
  );
});

test("maps authored project documents broadly and fails closed for opaque stage items", () => {
  for (const scope of ["concept", "brief", "script"] as const) {
    assert.deepEqual(
      boardRevisionTargetToRerunTarget(projectId, { scope }),
      { kind: "project", projectId }
    );
  }
  assert.equal(
    boardRevisionTargetToRerunTarget(projectId, {
      scope: "tile",
      runId: "run-1",
      stageId: "stage-1",
      itemId: "item-1",
      artifactId: "artifact-1",
    }),
    null
  );
});
