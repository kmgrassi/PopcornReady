import assert from "node:assert/strict";
import test from "node:test";
import { GENERATION_STAGE_ORDER } from "@popcorn/shared/v1/types";
import type {
  OrchestratorRunGate,
  RunActionSummary,
} from "@/lib/api/v1/orchestrator-store";
import {
  downstreamActionIds,
  downstreamGateIds,
  isInsufficientCreditsFailure,
  restartSelectionScope,
} from "../orchestrator-runs";

function action(id: string, tool: string): RunActionSummary {
  return { id, tool, status: "applied", params: {}, outputAssetIds: [], jobIds: [], createdAt: "t0" };
}

function gate(id: string, stage: string): OrchestratorRunGate {
  return { id, orchestratorRunId: "run1", stage, status: "approved", createdAt: "t0", updatedAt: "t0" };
}

// brief_intake(0) creative_plan(1) storyboard(2) asset_generation(3)
// audio_generation(4) timeline_assembly(5) quality_review(6) export(7)
const actions: RunActionSummary[] = [
  action("a-brief", "create_or_load_brief"), // 0
  action("a-plan", "plan"), // 1 (default)
  action("a-board", "generate_storyboard"), // 2
  action("a-key", "generate_keyframe"), // 3
  action("a-clip", "generate_clip"), // 3
  action("a-audio", "generate_audio"), // 4
  action("a-fit", "fit_audio_to_picture"), // 4
  action("a-timeline", "assemble_timeline"), // 5
  action("a-export", "export_video"), // 7
];

test("downstreamActionIds selects the target stage and everything after it", () => {
  const fromStoryboard = downstreamActionIds(actions, GENERATION_STAGE_ORDER.storyboard);
  assert.deepEqual(fromStoryboard, [
    "a-board",
    "a-key",
    "a-clip",
    "a-audio",
    "a-fit",
    "a-timeline",
    "a-export",
  ]);
});

test("downstreamActionIds from asset_generation excludes brief/plan/storyboard", () => {
  const fromAssets = downstreamActionIds(actions, GENERATION_STAGE_ORDER.asset_generation);
  assert.deepEqual(fromAssets, ["a-key", "a-clip", "a-audio", "a-fit", "a-timeline", "a-export"]);
});

test("downstreamActionIds from export only supersedes the export action", () => {
  const fromExport = downstreamActionIds(actions, GENERATION_STAGE_ORDER.export);
  assert.deepEqual(fromExport, ["a-export"]);
});

test("downstreamGateIds resets only gates at/after the target stage", () => {
  const gates: OrchestratorRunGate[] = [
    gate("g-board", "generate_storyboard"), // 2
    gate("g-clip", "generate_clip"), // 3
    gate("g-export", "export_video"), // 7
  ];
  assert.deepEqual(downstreamGateIds(gates, GENERATION_STAGE_ORDER.asset_generation), [
    "g-clip",
    "g-export",
  ]);
});

test("restartSelectionScope from asset_generation clears beat + downstream selections", () => {
  const scope = restartSelectionScope(GENERATION_STAGE_ORDER.asset_generation);
  // beat keyframe/clip selections are the ones that drive the skip bug.
  assert.ok(scope.rolePrefixes.includes("beat_keyframe:"));
  assert.ok(scope.rolePrefixes.includes("beat_clip:"));
  assert.ok(scope.exactRoles.includes("visual_anchors"));
  // downstream audio + timeline selections too.
  assert.ok(scope.rolePrefixes.includes("voiceover:"));
  assert.ok(scope.rolePrefixes.includes("audio_fit:"));
  assert.ok(scope.exactRoles.includes("cut"));
  // upstream brief/plan selections are left intact.
  assert.ok(!scope.exactRoles.includes("brief"));
  assert.ok(!scope.exactRoles.includes("plan"));
});

test("restartSelectionScope from timeline only clears the cut selection", () => {
  const scope = restartSelectionScope(GENERATION_STAGE_ORDER.timeline_assembly);
  assert.deepEqual(scope, { exactRoles: ["cut"], rolePrefixes: [] });
});

test("credit recovery accepts only a failed insufficient-credit action", () => {
  const creditFailure: RunActionSummary = {
    ...action("a-credit", "generate_clip"),
    status: "failed",
    error: { kind: "insufficient_credits", message: "Out of credits." },
  };
  assert.equal(isInsufficientCreditsFailure(creditFailure), true);
  assert.equal(isInsufficientCreditsFailure(action("a-provider", "generate_clip")), false);
  assert.equal(
    isInsufficientCreditsFailure({
      ...creditFailure,
      error: { kind: "provider_failed", message: "Provider failed." },
    }),
    false,
  );
});
