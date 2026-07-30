import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectGraphSnapshot } from "@/lib/orchestrator-context/graph-snapshot";
import {
  buildRerunDecisionPacket,
  canonicalTimelineItemIds,
  canonicalTimelineItems,
  RERUN_CONTEXT_LIMITS,
} from "../rerun-decision-context";

function snapshot(assetCount = 3): ProjectGraphSnapshot {
  return {
    projectId: "p",
    workspaceId: "w",
    loadedAt: "2026-07-29T00:00:00.000Z",
    assets: Array.from({ length: assetCount }, (_, index) => ({
      id: `asset-${index}`,
      projectId: "p",
      workspaceId: "w",
      lineageId: `lineage-${index}`,
      version: 1,
      kind: index === 0 ? "keyframe" : "clip",
      media: index === 0 ? "image" : "video",
      status: "ready",
      role: index === 0 ? "beat_keyframe" : "beat_clip",
      contentHash: `hash-${index}`,
      inputsFingerprint: `fingerprint-${index}`,
      inputs: index === 0 ? [] : [{
        assetId: `asset-${index - 1}`,
        relation: "input",
      }],
      createdAt: "2026-07-29T00:00:00.000Z",
    })),
    selections: [{
      projectId: "p",
      slotOwnerLineageId: "beat-1",
      slotRole: "beat_keyframe",
      seq: 3,
      activeAssetId: "asset-0",
    }],
    storyBlueprint: { id: "story-1", projectId: "p", assetId: "asset-0", briefAssetId: null, status: "draft" },
    storyboards: [{ id: "story-1", projectId: "p", status: "draft", planAssetId: null }],
    scenes: [{
      id: "scene-1", projectId: "p", storyboardId: "story-1", sceneIndex: 0,
      sceneAssetId: null, status: "draft",
    }],
    beats: [{
      id: "beat-1", projectId: "p", sceneId: "scene-1", beatIndex: 0,
      intent: "Open", status: "draft", beatAssetId: "asset-0",
    }],
    panels: [{
      id: "panel-1", projectId: "p", beatId: "beat-1", panelIndex: 0,
      imageAssetId: "asset-0", promptAssetId: null, status: "ready", isSelected: true,
    }],
    actionLinks: [],
    runs: [],
    agentSessions: [],
    runGates: [],
    droppedForeignRowCount: 0,
  };
}

const root = {
  id: "root",
  schemaVersion: "orchestrator_run.v1" as const,
  projectId: "p",
  status: "waiting" as const,
  inputSummary: "test",
  agentRole: "creative_director" as const,
  rootExecutionProfile: "creative_director" as const,
  spentUsd: 0,
  createdAt: "now",
  updatedAt: "now",
};

test("packet computes bounded downstream depth, pins canonical story pointers, and deduplicates targets", () => {
  const result = buildRerunDecisionPacket({
    snapshot: snapshot(RERUN_CONTEXT_LIMITS.downstreamCandidates + 5),
    rootRun: root,
    userIntent: "Brighten it",
    targets: [
      { kind: "asset", projectId: "p", assetId: "asset-0" },
      { kind: "asset", projectId: "p", assetId: "asset-0" },
    ],
    recentActions: Array.from({ length: RERUN_CONTEXT_LIMITS.actions + 2 }, (_, index) => ({
      id: `action-${index}`,
      tool: index === 0 ? "domain_report" : "generate_clip",
      status: "applied",
      params: {},
      outputAssetIds: [],
      jobIds: [],
      createdAt: "now",
    })),
  });
  assert.equal(result.targets.length, 1);
  assert.equal(result.candidateAffectedAssetIds.length, RERUN_CONTEXT_LIMITS.downstreamCandidates);
  assert.equal(result.truncation.downstreamCandidates, true);
  assert.equal(result.recentActions.length, RERUN_CONTEXT_LIMITS.actions);
  assert.equal(result.truncation.actions, true);
  assert.deepEqual(result.pins.storySnapshots.map((pin) => pin.rowKind), [
    "story_blueprint", "storyboard", "story_scene", "story_beat",
  ]);
  assert.equal(result.pins.storySnapshots.some((pin) => pin.rowKind === ("panel" as never)), false);
});

test("project, root profile, target project, and unpinned selection mismatches fail before decisioning", () => {
  assert.throws(() => buildRerunDecisionPacket({
    snapshot: snapshot(),
    rootRun: { ...root, rootExecutionProfile: "flat" },
    userIntent: "x",
    targets: [{ kind: "project", projectId: "p" }],
  }), /Creative Director root/);
  assert.throws(() => buildRerunDecisionPacket({
    snapshot: snapshot(),
    rootRun: { ...root, status: "succeeded" },
    userIntent: "x",
    targets: [{ kind: "project", projectId: "p" }],
  }), /Creative Director root/);
  assert.throws(() => buildRerunDecisionPacket({
    snapshot: snapshot(),
    rootRun: root,
    userIntent: "x",
    targets: [{ kind: "asset", projectId: "other", assetId: "asset-0" }],
  }), /path project/);
  assert.throws(() => buildRerunDecisionPacket({
    snapshot: snapshot(),
    rootRun: root,
    userIntent: "x",
    targets: [{
      kind: "selection", projectId: "p", slotOwnerLineageId: null, slotRole: "missing",
    }],
  }), /not authorized/);
});

test("shared upstream anchors pull sibling consumers into bounded related context", () => {
  const graph = snapshot();
  graph.assets = [{
    ...graph.assets[0]!,
    id: "anchor",
    kind: "anchor",
    role: "character_anchor",
    inputs: [],
  }, {
    ...graph.assets[0]!,
    id: "shot-a",
    lineageId: "shot-a-lineage",
    inputs: [{ assetId: "anchor", relation: "input", role: "character_anchor" }],
  }, {
    ...graph.assets[0]!,
    id: "shot-b",
    lineageId: "shot-b-lineage",
    inputs: [{ assetId: "anchor", relation: "input", role: "character_anchor" }],
  }];
  const result = buildRerunDecisionPacket({
    snapshot: graph,
    rootRun: root,
    userIntent: "Make the shared character older",
    targets: [{ kind: "asset", projectId: "p", assetId: "shot-a" }],
  });
  assert.equal(result.assets.find((candidate) => candidate.id === "anchor")?.relationToTarget, "upstream");
  assert.equal(result.assets.find((candidate) => candidate.id === "shot-b")?.relationToTarget, "sibling");
});

test("nested asset context and selection pins are deterministically deduplicated and capped", () => {
  const graph = snapshot(1);
  graph.assets[0] = {
    ...graph.assets[0]!,
    inputs: Array.from(
      { length: RERUN_CONTEXT_LIMITS.inputsPerAsset + 4 },
      (_, index) => ({ assetId: `input-${index}`, relation: "input" })
    ).concat([{ assetId: "input-0", relation: "input" }]),
  };
  graph.selections = Array.from(
    { length: RERUN_CONTEXT_LIMITS.selectionPins + 5 },
    (_, index) => ({
      projectId: "p",
      slotOwnerLineageId: `beat-${index}`,
      slotRole: "beat_keyframe",
      seq: index,
      activeAssetId: "asset-0",
    })
  ).concat([{
    projectId: "p",
    slotOwnerLineageId: "beat-0",
    slotRole: "beat_keyframe",
    seq: 999,
    activeAssetId: "asset-0",
  }]);
  const result = buildRerunDecisionPacket({
    snapshot: graph,
    rootRun: root,
    userIntent: "Bound this context",
    targets: [{ kind: "asset", projectId: "p", assetId: "asset-0" }],
  });
  assert.equal(result.assets[0]!.inputs.length, RERUN_CONTEXT_LIMITS.inputsPerAsset);
  assert.equal(result.assets[0]!.selectionRefs.length, RERUN_CONTEXT_LIMITS.selectionRefsPerAsset);
  assert.equal(result.pins.selections.length, RERUN_CONTEXT_LIMITS.selectionPins);
  assert.equal(result.truncation.assetInputs, true);
  assert.equal(result.truncation.selectionRefs, true);
  assert.equal(result.truncation.selectionPins, true);
  assert.equal(new Set(result.pins.selections.map((pin) =>
    `${pin.slotOwnerLineageId}:${pin.slotRole}`)).size, result.pins.selections.length);
});

test("explicit selection and story targets retain their real pins beyond snapshot-order caps", () => {
  const selectionGraph = snapshot(1);
  selectionGraph.selections = Array.from(
    { length: RERUN_CONTEXT_LIMITS.selectionPins + 5 },
    (_, index) => ({
      projectId: "p",
      slotOwnerLineageId: `beat-${index}`,
      slotRole: "beat_keyframe",
      seq: index + 1,
      activeAssetId: "asset-0",
    })
  );
  const targetedSelection = selectionGraph.selections.at(-1)!;
  const selectionPacket = buildRerunDecisionPacket({
    snapshot: selectionGraph,
    rootRun: root,
    userIntent: "Revise the last slot",
    targets: [{
      kind: "selection",
      projectId: "p",
      slotOwnerLineageId: targetedSelection.slotOwnerLineageId,
      slotRole: targetedSelection.slotRole,
    }],
  });
  assert.deepEqual(selectionPacket.pins.selections[0], {
    slotOwnerLineageId: targetedSelection.slotOwnerLineageId,
    slotRole: targetedSelection.slotRole,
    expectedActiveAssetId: "asset-0",
    expectedSeq: targetedSelection.seq,
  });
  assert.equal(selectionPacket.truncation.selectionPins, true);

  const storyGraph = snapshot(1);
  storyGraph.beats = Array.from(
    { length: RERUN_CONTEXT_LIMITS.storyRows + 5 },
    (_, index) => ({
      id: `beat-${index}`,
      projectId: "p",
      sceneId: "scene-1",
      beatIndex: index,
      intent: `Beat ${index}`,
      status: "draft",
      beatAssetId: index === RERUN_CONTEXT_LIMITS.storyRows + 4 ? "asset-0" : null,
    })
  );
  const targetedBeat = storyGraph.beats.at(-1)!;
  const storyPacket = buildRerunDecisionPacket({
    snapshot: storyGraph,
    rootRun: root,
    userIntent: "Revise the last beat",
    targets: [{ kind: "beat", projectId: "p", beatId: targetedBeat.id }],
  });
  assert.deepEqual(storyPacket.pins.storySnapshots[0], {
    rowKind: "story_beat",
    rowId: targetedBeat.id,
    expectedSnapshotAssetId: "asset-0",
  });
  assert.equal(
    storyPacket.story.beats.find((beat) => beat.id === targetedBeat.id)?.intent,
    targetedBeat.intent
  );
  assert.equal(storyPacket.truncation.storyRows, true);
});

test("storyboard targets pin their distinct plan pointer instead of the blueprint pointer", () => {
  const graph = snapshot(2);
  graph.storyBlueprint = {
    id: "blueprint-1",
    projectId: "p",
    assetId: "asset-0",
    briefAssetId: null,
    status: "draft",
  };
  graph.storyboards = [{
    id: "storyboard-1",
    projectId: "p",
    planAssetId: "asset-1",
    status: "draft",
  }];
  const result = buildRerunDecisionPacket({
    snapshot: graph,
    rootRun: root,
    userIntent: "Revise story",
    targets: [{ kind: "storyboard", projectId: "p", storyboardId: "storyboard-1" }],
  });
  assert.deepEqual(result.pins.storySnapshots.find((pin) =>
    pin.rowKind === "storyboard" && pin.rowId === "storyboard-1"), {
    rowKind: "storyboard",
    rowId: "storyboard-1",
    expectedSnapshotAssetId: "asset-1",
  });
  assert.deepEqual(result.pins.storySnapshots.find((pin) =>
    pin.rowKind === "story_blueprint" && pin.rowId === "blueprint-1"), {
    rowKind: "story_blueprint",
    rowId: "blueprint-1",
    expectedSnapshotAssetId: "asset-0",
  });
});

test("semantic summaries and causal action context are bounded while terminal reports keep their own budget", () => {
  const graph = snapshot(1);
  graph.assets[0] = {
    ...graph.assets[0]!,
    name: "n".repeat(RERUN_CONTEXT_LIMITS.summaryText + 20),
    description: "d".repeat(RERUN_CONTEXT_LIMITS.summaryText + 20),
    durationSec: 4.25,
  };
  const reports = Array.from(
    { length: RERUN_CONTEXT_LIMITS.terminalReports + 3 },
    (_, index) => ({
      id: `report-${index}`,
      tool: "domain_report",
      status: "applied",
      params: { summary: `report ${index}` },
      rationale: "terminal",
      outputAssetIds: [],
      jobIds: [],
      createdAt: `2026-07-28T00:${String(index).padStart(2, "0")}:00.000Z`,
    })
  );
  const ordinary = Array.from(
    { length: RERUN_CONTEXT_LIMITS.actions + 10 },
    (_, index) => ({
      id: `ordinary-${index}`,
      tool: "generate_clip",
      status: "applied",
      params: { prompt: "p".repeat(RERUN_CONTEXT_LIMITS.actionParamsChars + 20) },
      rationale: "r".repeat(RERUN_CONTEXT_LIMITS.summaryText + 20),
      outputAssetIds: [],
      jobIds: [],
      createdAt: `2026-07-29T00:${String(index).padStart(2, "0")}:00.000Z`,
    })
  );
  const result = buildRerunDecisionPacket({
    snapshot: graph,
    rootRun: root,
    userIntent: "Inspect semantics",
    targets: [{ kind: "asset", projectId: "p", assetId: "asset-0" }],
    recentActions: [...reports, ...ordinary],
  });
  assert.equal(result.assets[0]!.name?.length, RERUN_CONTEXT_LIMITS.summaryText);
  assert.equal(result.assets[0]!.description?.length, RERUN_CONTEXT_LIMITS.summaryText);
  assert.equal(result.assets[0]!.durationSec, 4.25);
  assert.equal(result.recentActions.length, RERUN_CONTEXT_LIMITS.actions);
  assert.equal(result.recentActions[0]!.params.truncated, true);
  assert.equal(result.recentActions[0]!.rationale?.length, RERUN_CONTEXT_LIMITS.summaryText);
  assert.equal(result.terminalDomainReports.length, RERUN_CONTEXT_LIMITS.terminalReports);
  assert.equal(result.truncation.actions, true);
  assert.equal(result.truncation.terminalReports, true);
});

test("timeline targets are authorized only from canonical top-level segment identity", () => {
  const timeline = {
    segments: [{
      id: "segment-1",
      clipId: "clip-1",
      beatId: "beat-1",
      sourceInSec: 1,
      sourceOutSec: 3,
      role: "Hook",
      reason: "Open strongly",
      nested: { timelineItemId: "nested-should-not-authorize" },
    }],
    timelineItemId: "root-should-not-authorize",
  };
  const ids = canonicalTimelineItemIds(timeline);
  assert.deepEqual([...ids], ["segment-1"]);
  assert.deepEqual(canonicalTimelineItems(timeline), [{
    id: "segment-1",
    clipAssetId: "clip-1",
    beatId: "beat-1",
    sourceInSec: 1,
    sourceOutSec: 3,
    role: "Hook",
    reason: "Open strongly",
    caption: null,
  }]);
});

test("project, timeline-item, and transcript targets seed backing assets and semantic rows", () => {
  const graph = snapshot(1);
  const assetBase = graph.assets[0]!;
  graph.assets = [{
    ...assetBase,
    id: "audio-source",
    lineageId: "audio-source-lineage",
    kind: "audio_track",
    media: "audio",
    role: "narration",
    inputs: [],
  }, {
    ...assetBase,
    id: "transcript-asset",
    lineageId: "transcript-lineage",
    kind: "transcript",
    media: "data",
    role: "transcript",
    inputs: [{ assetId: "audio-source", relation: "input", role: "transcribed_from" }],
  }, {
    ...assetBase,
    id: "beat-snapshot",
    lineageId: "beat-snapshot-lineage",
    kind: "beat",
    media: "data",
    role: "beat",
    inputs: [],
  }, {
    ...assetBase,
    id: "clip-1",
    lineageId: "clip-lineage",
    kind: "clip",
    media: "video",
    role: "beat_clip",
    inputs: [{ assetId: "beat-snapshot", relation: "input", role: "beat" }],
  }, {
    ...assetBase,
    id: "cut-1",
    lineageId: "cut-lineage",
    kind: "composite",
    media: "data",
    role: "timeline",
    inputs: [{ assetId: "clip-1", relation: "input", role: "clip" }],
  }];
  graph.beats[0] = { ...graph.beats[0]!, beatAssetId: "beat-snapshot" };
  graph.selections = [{
    projectId: "p",
    slotOwnerLineageId: null,
    slotRole: "cut",
    seq: 2,
    activeAssetId: "cut-1",
  }];
  const timelineItems = [{
    id: "segment-1",
    clipAssetId: "clip-1",
    beatId: "beat-1",
    sourceInSec: 0,
    sourceOutSec: 4,
    role: "Hook",
    reason: "Opens the cut",
    caption: "Hello",
  }];
  const transcriptSegments = [{
    id: "transcript-segment-1",
    transcriptAssetId: "transcript-asset",
    position: 0,
    startSec: 1,
    endSec: 3,
    text: "Please shorten this line.",
    speaker: "Narrator",
  }];

  const timelinePacket = buildRerunDecisionPacket({
    snapshot: graph,
    rootRun: root,
    userIntent: "Shorten this shot",
    targets: [{ kind: "timeline_item", projectId: "p", timelineItemId: "segment-1" }],
    timelineAssetId: "cut-1",
    timelineItems,
    transcriptSegments,
  });
  assert.deepEqual(new Set(timelinePacket.assets.map((asset) => asset.id)), new Set([
    "cut-1", "clip-1", "beat-snapshot",
  ]));
  assert.deepEqual(timelinePacket.timelineItems, timelineItems);

  const transcriptPacket = buildRerunDecisionPacket({
    snapshot: graph,
    rootRun: root,
    userIntent: "Shorten this narration segment",
    targets: [{
      kind: "transcript_segment",
      projectId: "p",
      transcriptSegmentId: "transcript-segment-1",
    }],
    timelineAssetId: "cut-1",
    timelineItems,
    transcriptSegments,
  });
  assert.deepEqual(new Set(transcriptPacket.assets.map((asset) => asset.id)), new Set([
    "transcript-asset", "audio-source",
  ]));
  assert.deepEqual(transcriptPacket.transcriptSegments, transcriptSegments);

  const projectPacket = buildRerunDecisionPacket({
    snapshot: graph,
    rootRun: null,
    userIntent: "Review the whole project",
    targets: [{ kind: "project", projectId: "p" }],
    timelineAssetId: "cut-1",
    timelineItems,
    transcriptSegments,
  });
  assert.equal(projectPacket.rootRun.id, null);
  assert.equal(projectPacket.rootRun.status, "unbound");
  assert.equal(projectPacket.assets.some((asset) => asset.id === "cut-1"), true);
  assert.equal(projectPacket.assets.some((asset) => asset.id === "transcript-asset"), true);
  assert.deepEqual(projectPacket.timelineItems, timelineItems);
  assert.deepEqual(projectPacket.transcriptSegments, transcriptSegments);
});

test("large project packets reserve semantic backing assets and omit rows without inspected pins", () => {
  const graph = snapshot(1);
  const assetBase = graph.assets[0]!;
  const selectionAssets = Array.from({ length: 130 }, (_, index) => ({
    ...assetBase,
    id: `selection-${index}`,
    lineageId: `selection-lineage-${index}`,
  }));
  const clipAssets = Array.from({ length: RERUN_CONTEXT_LIMITS.timelineItems }, (_, index) => ({
    ...assetBase,
    id: `clip-${index}`,
    lineageId: `clip-lineage-${index}`,
    kind: "clip",
    media: "video",
    role: "beat_clip",
  }));
  const transcriptAssets = Array.from(
    { length: RERUN_CONTEXT_LIMITS.transcriptSegments },
    (_, index) => ({
      ...assetBase,
      id: `transcript-${index}`,
      lineageId: `transcript-lineage-${index}`,
      kind: "transcript",
      media: "data",
      role: "transcript",
    })
  );
  graph.assets = [{
    ...assetBase,
    id: "cut-1",
    lineageId: "cut-lineage",
    kind: "composite",
    media: "data",
    role: "timeline",
  }, ...clipAssets, ...transcriptAssets, ...selectionAssets];
  graph.selections = selectionAssets.map((asset, index) => ({
    projectId: "p",
    slotOwnerLineageId: `owner-${index}`,
    slotRole: "beat_keyframe",
    seq: 1,
    activeAssetId: asset.id,
  }));
  graph.storyBlueprint = null;
  graph.storyboards = [];
  graph.scenes = [];
  graph.beats = [];
  graph.panels = [];
  const timelineItems = clipAssets.map((asset, index) => ({
    id: `segment-${index}`,
    clipAssetId: asset.id,
    beatId: null,
    sourceInSec: 0,
    sourceOutSec: 1,
    role: null,
    reason: null,
    caption: null,
  }));
  const transcriptSegments = transcriptAssets.map((asset, index) => ({
    id: `transcript-segment-${index}`,
    transcriptAssetId: asset.id,
    position: index,
    startSec: index,
    endSec: index + 1,
    text: `Line ${index}`,
    speaker: null,
  }));
  const result = buildRerunDecisionPacket({
    snapshot: graph,
    rootRun: null,
    userIntent: "Review the whole project",
    targets: [{ kind: "project", projectId: "p" }],
    timelineAssetId: "cut-1",
    timelineItems,
    transcriptSegments,
  });
  const inspectedIds = new Set(result.assets.map((asset) => asset.id));
  const pinnedIds = new Set(result.pins.assets.map((pin) => pin.assetId));
  assert.equal(result.timelineItems.length, RERUN_CONTEXT_LIMITS.timelineItems);
  assert.equal(result.transcriptSegments.length, 39);
  assert.equal(result.truncation.timelineItems, false);
  assert.equal(result.truncation.transcriptSegments, true);
  for (const item of result.timelineItems) {
    assert.equal(inspectedIds.has("cut-1"), true);
    assert.equal(inspectedIds.has(item.clipAssetId), true);
    assert.equal(pinnedIds.has(item.clipAssetId), true);
  }
  for (const segment of result.transcriptSegments) {
    assert.equal(inspectedIds.has(segment.transcriptAssetId), true);
    assert.equal(pinnedIds.has(segment.transcriptAssetId), true);
  }
});
