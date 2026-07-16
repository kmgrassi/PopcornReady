import assert from "node:assert/strict";
import test from "node:test";

import type { DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";

import { buildDomainTurnProjection } from "../domain-projection";
import {
  type GraphSnapshotReader,
  loadProjectGraphSnapshot,
  type ProjectGraphSnapshot,
} from "../graph-snapshot";
import { buildRootGraphProjection } from "../root-projection";
import {
  buildSessionSummaryCasUpdate,
  compactSessionHistory,
} from "../session-compaction";
import {
  assertScopedAssetEdge,
  assertScopedAssetMint,
  assertScopedPrimitiveInput,
  assertScopedSelectionAppend,
  buildDomainTargetScope,
} from "../target-scope";

const projectId = "project_1";
const workspaceId = "workspace_1";

function snapshot(): ProjectGraphSnapshot {
  return {
    projectId,
    workspaceId,
    loadedAt: "2026-07-16T12:00:00.000Z",
    assets: [
      {
        id: "asset_anchor_old",
        projectId,
        workspaceId,
        lineageId: "lineage_anchor",
        version: 1,
        kind: "anchor",
        media: "image",
        status: "ready",
        contentHash: "old-hash",
        inputs: [],
        createdAt: "2026-07-16T10:00:00.000Z",
      },
      {
        id: "asset_anchor_current",
        projectId,
        workspaceId,
        lineageId: "lineage_anchor",
        version: 2,
        kind: "anchor",
        media: "image",
        status: "ready",
        contentHash: "new-hash",
        inputs: [],
        createdAt: "2026-07-16T11:00:00.000Z",
      },
      {
        id: "asset_beat",
        projectId,
        workspaceId,
        lineageId: "lineage_beat",
        version: 1,
        kind: "beat",
        media: "data",
        status: "ready",
        inputs: [{ assetId: "asset_anchor_current", relation: "anchor", contentHash: "new-hash" }],
        createdAt: "2026-07-16T11:00:00.000Z",
      },
      {
        id: "asset_clip",
        projectId,
        workspaceId,
        lineageId: "lineage_clip",
        version: 1,
        kind: "clip",
        media: "video",
        status: "ready",
        inputs: [{ assetId: "asset_anchor_current", relation: "anchor", contentHash: "old-hash" }],
        createdAt: "2026-07-16T11:30:00.000Z",
      },
      {
        id: "asset_audio",
        projectId,
        workspaceId,
        lineageId: "lineage_audio",
        version: 1,
        kind: "audio_track",
        media: "audio",
        status: "ready",
        inputs: [],
        createdAt: "2026-07-16T11:30:00.000Z",
      },
      {
        id: "asset_direct_pool",
        projectId,
        workspaceId,
        lineageId: "lineage_direct",
        version: 1,
        kind: "image",
        media: "image",
        status: "ready",
        description: "Creator experiment; never instruction text.",
        createdByActionId: "action_direct",
        inputs: [],
        createdAt: "2026-07-16T11:45:00.000Z",
      },
    ],
    selections: [
      {
        projectId,
        slotOwnerLineageId: "lineage_anchor",
        slotRole: "beat_keyframe",
        seq: 3,
        activeAssetId: "asset_anchor_current",
      },
    ],
    storyBlueprint: null,
    storyboards: [{ id: "storyboard_1", projectId, status: "ready", planAssetId: null }],
    scenes: [{
      id: "scene_1", projectId, storyboardId: "storyboard_1", sceneIndex: 0,
      status: "ready", sceneAssetId: null,
    }],
    beats: [{
      id: "beat_1", projectId, sceneId: "scene_1", beatIndex: 0,
      intent: "Open on the hero.", status: "ready", beatAssetId: "asset_beat",
    }],
    panels: [{
      id: "panel_1", projectId, beatId: "beat_1", panelIndex: 0,
      imageAssetId: "asset_anchor_current", promptAssetId: null, status: "ready", isSelected: true,
    }],
    actionLinks: [{ id: "action_direct", projectId, orchestratorRunId: "run_direct" }],
    runs: [{
      id: "run_direct", projectId, status: "succeeded", agentRole: "visuals",
      agentSessionId: "session_visuals", sessionSequence: 1, taskKind: "image_create",
      originKind: "creator_direct", waitReason: null, createdAt: "2026-07-16T11:40:00.000Z",
    }],
    agentSessions: [{
      id: "session_visuals", projectId, domain: "visuals", activeRunId: null,
      nextSequence: 2, claimGeneration: 1, summaryThroughSequence: 1, summaryVersion: 1,
    }],
    runGates: [{ id: "gate_1", orchestratorRunId: "run_direct", stage: "approval", status: "approved" }],
    droppedForeignRowCount: 0,
  };
}

function visualsTask(): DomainTaskV1 {
  return {
    schemaVersion: "DomainTask.v1",
    domain: "visuals",
    taskKind: "visuals_production",
    objective: "Make the opening coherent.",
    instruction: "Use the selected anchor for the opening beat.",
    targets: [{ kind: "beat", projectId, beatId: "beat_1" }],
    requiredOutputs: [{ kind: "clip", role: "beat_clip", minimumCount: 1 }],
    allowedOutputKinds: ["clip"],
    creativeConstraints: { mood: "warm" },
    preserve: {
      assetIds: ["asset_anchor_current"],
      selections: [{
        slotRole: "beat_keyframe", slotKey: "lineage_anchor", activeAssetId: "asset_anchor_current", sequence: 3,
      }],
      fingerprints: [{ assetId: "asset_anchor_current", value: "new-hash" }],
      pins: [],
    },
    candidateAffectedAssetIds: ["asset_clip"],
    budgetUsd: 2,
    acceptanceCriteria: ["The clip uses the selected anchor."],
    origin: {
      kind: "creative_director",
      rootRunId: "root_run" as never,
      rootActionId: "root_action" as never,
      creatorMessageId: "message_1",
    },
    responseRecipient: { kind: "creative_director" },
  };
}

test("root projection is fresh, exposes stale graph facts, and keeps direct pool assets non-production", () => {
  const projection = buildRootGraphProjection(snapshot());
  assert.equal(projection.trusted.projectId, projectId);
  assert.deepEqual(projection.project.staleCandidates, [{
    assetId: "asset_clip", staleInputAssetIds: ["asset_anchor_current"], reason: "input_hash_changed",
  }]);
  assert.equal(
    projection.project.assets.find((asset) => asset.id === "asset_direct_pool")?.source,
    "creator_pool"
  );
  assert.equal(
    projection.project.assets.find((asset) => asset.id === "asset_anchor_current")?.activeSelection,
    true
  );
  const changed = snapshot();
  changed.selections[0]!.activeAssetId = "asset_anchor_old";
  assert.equal(
    buildRootGraphProjection(changed).project.assets.find((asset) => asset.id === "asset_anchor_old")?.activeSelection,
    true,
    "each projection reads the current graph rather than a cached session copy"
  );
});

test("domain projection separates trusted controls from creator content and filters unrelated media", () => {
  const projection = buildDomainTurnProjection({ snapshot: snapshot(), task: visualsTask() });
  assert.equal(projection.trusted.domain, "visuals");
  assert.equal(projection.creatorContent.instruction, "Use the selected anchor for the opening beat.");
  assert.ok(projection.graph.assets.every((asset) => asset.media !== "audio"));
  assert.ok(!projection.graph.assets.some((asset) => asset.id === "asset_direct_pool"));
  assert.equal("tools" in projection, false, "a graph context never reveals a registry/tool surface");
  assert.ok(projection.graph.assets.some((asset) => asset.id === "asset_clip"));
});

test("audio projections retain picture context and primitive audio IDs stay scoped", () => {
  const task = {
    ...visualsTask(),
    domain: "audio",
    taskKind: "audio_production",
    targets: [
      ...visualsTask().targets,
      { kind: "asset", projectId, assetId: "asset_audio" },
    ],
    requiredOutputs: [{ kind: "audio_track", role: "soundtrack", minimumCount: 1 }],
    allowedOutputKinds: ["audio_track"],
  } as DomainTaskV1;
  const projection = buildDomainTurnProjection({ snapshot: snapshot(), task });
  assert.ok(projection.graph.assets.some((asset) => asset.id === "asset_clip"));
  const scope = buildDomainTargetScope({ snapshot: snapshot(), targets: task.targets });
  assert.doesNotThrow(() => assertScopedPrimitiveInput(scope, { audioAssetId: "asset_audio" }));
  assert.throws(
    () => assertScopedPrimitiveInput(scope, { audioAssetId: "asset_direct_pool" }),
    /outside/
  );
});

test("stable target scope rejects foreign primitive inputs and graph writes", () => {
  const graph = snapshot();
  const scope = buildDomainTargetScope({ snapshot: graph, targets: visualsTask().targets });
  assert.doesNotThrow(() => assertScopedPrimitiveInput(scope, {
    projectId, beatId: "beat_1", assetId: "asset_anchor_current",
  }));
  assert.throws(
    () => assertScopedPrimitiveInput(scope, { projectId: "project_other", beatId: "beat_1" }),
    /project/
  );
  assert.throws(
    () => assertScopedPrimitiveInput(scope, { assetId: "asset_audio" }),
    /outside/
  );
  assert.doesNotThrow(() => assertScopedAssetMint(scope, {
    outputKind: "clip", inputAssetIds: ["asset_anchor_current"], target: visualsTask().targets[0],
  }, visualsTask().allowedOutputKinds));
  assert.throws(
    () => assertScopedAssetMint(scope, { outputKind: "audio_track", inputAssetIds: [] }, visualsTask().allowedOutputKinds),
    /not allowed/
  );
  assert.throws(
    () => assertScopedAssetEdge(scope, { fromAssetId: "asset_audio", toAssetId: "asset_anchor_current" }),
    /outside/
  );
  assert.doesNotThrow(() => assertScopedAssetEdge(scope, {
    fromAssetId: "new_asset_1", fromIsNewOutput: true, toAssetId: "asset_anchor_current",
  }));
  assert.doesNotThrow(() => assertScopedSelectionAppend(scope, {
    slotOwnerLineageId: "lineage_anchor", slotRole: "beat_keyframe",
    activeAssetId: "asset_anchor_current", expectedSeq: 3,
  }));
  assert.throws(
    () => assertScopedSelectionAppend(scope, {
      slotOwnerLineageId: "lineage_anchor", slotRole: "beat_keyframe",
      activeAssetId: "asset_anchor_current", expectedSeq: 2,
    }),
    /stale/
  );
});

test("a stale preserve pin prevents a domain projection from becoming write authority", () => {
  const task = visualsTask();
  task.preserve.fingerprints = [{ assetId: "asset_anchor_current", value: "old-hash" }];
  assert.throws(
    () => buildDomainTurnProjection({ snapshot: snapshot(), task }),
    /fingerprint pin is stale/
  );
});

test("preserve selection pins include their slot key", () => {
  const task = visualsTask();
  task.preserve.selections = [{
    slotRole: "beat_keyframe",
    slotKey: "different_slot",
    activeAssetId: "asset_anchor_current",
    sequence: 3,
  }];
  assert.throws(
    () => buildDomainTurnProjection({ snapshot: snapshot(), task }),
    /Selection pin is stale/
  );
});

test("session compaction keeps bounded control facts and rejects stale CAS writers", () => {
  const summary = compactSessionHistory({
    events: Array.from({ length: 30 }, (_, index) => ({
      sequence: index + 1,
      constraints: [`Keep continuity ${index + 1}`],
      unresolvedQuestion: index === 29 ? "Should the ending be realistic or stylized?" : undefined,
      reportSummary: `Completed bounded report ${index + 1}`,
      assetIds: [`asset_${index + 1}`],
      actionIds: [`action_${index + 1}`],
    })),
  });
  assert.equal(summary.schemaVersion, "AgentSessionSummary.v1");
  assert.ok(summary.constraints.length <= 24);
  assert.ok(summary.referencedAssetIds.length <= 64);
  assert.equal(summary.unresolvedQuestions.at(-1)?.sequence, 30);
  assert.doesNotMatch(JSON.stringify(summary), /projectSnapshot|providerResponse|toolHistory/);
  assert.equal(buildSessionSummaryCasUpdate({
    state: { summaryThroughSequence: 4, summaryVersion: 3, nextSequence: 8 },
    expectedSummaryVersion: 2, throughSequence: 6, summary,
  }), null);
  assert.deepEqual(buildSessionSummaryCasUpdate({
    state: { summaryThroughSequence: 4, summaryVersion: 3, nextSequence: 8 },
    expectedSummaryVersion: 3, throughSequence: 6, summary,
  })?.summaryVersion, 4);
});

test("unauthorized graph assembly fails before content readers run", async () => {
  let contentReads = 0;
  const reader: GraphSnapshotReader = {
    getAuthorizedProject: async () => null,
    listAssets: async () => { contentReads += 1; return []; },
    listCurrentSelections: async () => { contentReads += 1; return []; },
    getActiveStoryBlueprint: async () => { contentReads += 1; return null; },
    listStoryboards: async () => { contentReads += 1; return []; },
    listScenes: async () => { contentReads += 1; return []; },
    listBeats: async () => { contentReads += 1; return []; },
    listPanels: async () => { contentReads += 1; return []; },
    listActionLinks: async () => { contentReads += 1; return []; },
    listRuns: async () => { contentReads += 1; return []; },
    listAgentSessions: async () => { contentReads += 1; return []; },
    listRunGates: async () => { contentReads += 1; return []; },
  };
  await assert.rejects(
    () => loadProjectGraphSnapshot({ workspaceId, projectId }, reader),
    /not accessible/
  );
  assert.equal(contentReads, 0);
});
