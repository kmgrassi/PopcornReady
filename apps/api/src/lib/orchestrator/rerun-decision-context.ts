import type { RerunTarget, StorySnapshotPin } from "@popcorn/shared/rerun-proposal";
import { ApiError } from "@/core/errors";
import {
  getActiveProjectTimelineAsset,
  getProjectStoryboard,
} from "@/lib/api/v1/store";
import {
  getOrchestratorRun,
  listRunActions,
  type OrchestratorRun,
} from "@/lib/api/v1/orchestrator-store";
import {
  loadProjectGraphSnapshot,
  type ProjectGraphSnapshot,
  type SnapshotAsset,
} from "@/lib/orchestrator-context/graph-snapshot";
import {
  getToolCapability,
  TOOL_NAMES,
} from "@/lib/orchestrator-tools/capability-catalog";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";

export const RERUN_CONTEXT_LIMITS = Object.freeze({
  targets: 20,
  inspectedAssets: 120,
  downstreamCandidates: 80,
  relatedAssets: 40,
  actions: 30,
  terminalReports: 12,
  storyRows: 80,
  timelineItems: 80,
  transcriptSegments: 80,
  inputsPerAsset: 24,
  selectionRefsPerAsset: 16,
  selectionPins: 100,
  summaryText: 500,
  actionParamsChars: 4_000,
});

export interface RerunDecisionPacket {
  schemaVersion: "RerunDecisionPacket.v1";
  projectId: string;
  rootRun: {
    id: string | null;
    status: string;
    spentUsd: number;
    budgetUsd: number | null;
  };
  userIntent: string;
  targets: RerunTarget[];
  assets: Array<{
    id: string;
    kind: string;
    role: string | null;
    name: string | null;
    description: string | null;
    durationSec: number | null;
    lineageId: string;
    version: number;
    contentHash: string | null;
    inputsFingerprint: string | null;
    inputs: SnapshotAsset["inputs"];
    selectionRefs: Array<{
      slotOwnerLineageId: string | null;
      slotRole: string;
      seq: number;
    }>;
    relationToTarget: "target" | "upstream" | "downstream" | "lineage" | "sibling";
    depth: number | null;
  }>;
  candidateAffectedAssetIds: string[];
  relatedAssetIds: string[];
  story: {
    blueprint: ProjectGraphSnapshot["storyBlueprint"];
    storyboards: ProjectGraphSnapshot["storyboards"];
    scenes: ProjectGraphSnapshot["scenes"];
    beats: ProjectGraphSnapshot["beats"];
    panels: ProjectGraphSnapshot["panels"];
  };
  timelineItems: RerunTimelineItem[];
  transcriptSegments: RerunTranscriptSegment[];
  recentActions: Array<{
    id: string;
    tool: string;
    status: string;
    outputAssetIds: string[];
    params: Record<string, unknown>;
    rationale?: string;
    error?: Record<string, unknown>;
  }>;
  terminalDomainReports: Array<{
    id: string;
    params: Record<string, unknown>;
  }>;
  capabilities: Array<{
    name: string;
    owner: "creative_director" | "visuals" | "audio";
    capability: string;
    costClass: "local" | "model" | "media" | "render";
  }>;
  pins: {
    assets: Array<{
      assetId: string;
      contentHash: string | null;
      inputsFingerprint: string | null;
    }>;
    selections: Array<{
      slotOwnerLineageId: string | null;
      slotRole: string;
      expectedActiveAssetId: string | null;
      expectedSeq: number;
    }>;
    storySnapshots: StorySnapshotPin[];
  };
  truncation: {
    assets: boolean;
    downstreamCandidates: boolean;
    relatedAssets: boolean;
    actions: boolean;
    terminalReports: boolean;
    storyRows: boolean;
    timelineItems: boolean;
    transcriptSegments: boolean;
    assetInputs: boolean;
    selectionRefs: boolean;
    selectionPins: boolean;
  };
}

export interface BuildRerunDecisionPacketInput {
  snapshot: ProjectGraphSnapshot;
  rootRun: OrchestratorRun | null;
  targets: RerunTarget[];
  userIntent: string;
  timelineAssetId?: string;
  timelineItems?: RerunTimelineItem[];
  transcriptSegments?: RerunTranscriptSegment[];
  recentActions?: Awaited<ReturnType<typeof listRunActions>>;
}

export interface RerunTimelineItem {
  id: string;
  clipAssetId: string;
  beatId: string | null;
  sourceInSec: number | null;
  sourceOutSec: number | null;
  role: string | null;
  reason: string | null;
  caption: string | null;
}

export interface RerunTranscriptSegment {
  id: string;
  transcriptAssetId: string;
  position: number;
  startSec: number;
  endSec: number;
  text: string;
  speaker: string | null;
}

function targetKey(target: RerunTarget): string {
  switch (target.kind) {
    case "project": return `project:${target.projectId}`;
    case "storyboard": return `storyboard:${target.storyboardId}`;
    case "scene": return `scene:${target.sceneId}`;
    case "beat": return `beat:${target.beatId}`;
    case "panel": return `panel:${target.panelId}`;
    case "asset": return `asset:${target.assetId}`;
    case "lineage": return `lineage:${target.lineageId}`;
    case "timeline_item": return `timeline_item:${target.timelineItemId}`;
    case "export": return `export:${target.exportId}`;
    case "selection":
      return `selection:${target.slotOwnerLineageId ?? "project"}:${target.slotRole}`;
    case "transcript_segment": return `transcript_segment:${target.transcriptSegmentId}`;
  }
}

function storyPinKey(pin: StorySnapshotPin): string {
  return `${pin.rowKind}:${pin.rowId}`;
}

function targetStoryPinKey(target: RerunTarget): string | null {
  if (target.kind === "storyboard") return `storyboard:${target.storyboardId}`;
  if (target.kind === "scene") return `story_scene:${target.sceneId}`;
  if (target.kind === "beat") return `story_beat:${target.beatId}`;
  return null;
}

function dedupe<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function bounded<T>(values: T[], limit: number): { values: T[]; truncated: boolean } {
  return { values: values.slice(0, limit), truncated: values.length > limit };
}

function semanticRowsForTargets(
  input: BuildRerunDecisionPacketInput,
  targets: RerunTarget[]
) {
  const projectTargeted = targets.some((target) => target.kind === "project");
  const timelineItemsById = new Map(
    (input.timelineItems ?? []).map((row) => [row.id, row])
  );
  const explicitTimelineItems = targets.flatMap((target) =>
    target.kind === "timeline_item"
      ? [timelineItemsById.get(target.timelineItemId)].filter(
        (row): row is RerunTimelineItem => Boolean(row)
      )
      : []);
  const timelineItems = bounded(dedupe([
    ...explicitTimelineItems,
    ...(projectTargeted ? input.timelineItems ?? [] : []),
  ], (row) => row.id), RERUN_CONTEXT_LIMITS.timelineItems);
  const transcriptSegmentsById = new Map(
    (input.transcriptSegments ?? []).map((row) => [row.id, row])
  );
  const explicitTranscriptSegments = targets.flatMap((target) =>
    target.kind === "transcript_segment"
      ? [transcriptSegmentsById.get(target.transcriptSegmentId)].filter(
        (row): row is RerunTranscriptSegment => Boolean(row)
      )
      : []);
  const transcriptSegments = bounded(dedupe([
    ...explicitTranscriptSegments,
    ...(projectTargeted ? input.transcriptSegments ?? [] : []),
  ], (row) => row.id), RERUN_CONTEXT_LIMITS.transcriptSegments);
  return { timelineItems, transcriptSegments };
}

function compactText(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  return value.trim().slice(0, RERUN_CONTEXT_LIMITS.summaryText);
}

const PROJECT_SELECTION_ROLES = new Set([
  "brief",
  "plan",
  "visual_anchors",
  "cut",
  "poster",
  "story_blueprint",
  "soundtrack:main",
  "script_draft",
  "critique",
  "export_video",
]);
const ASSET_OWNED_SELECTION_ROLES = new Set([
  "anchor",
  "beat_keyframe",
  "beat_clip",
  "voiceover",
]);

function isServerRecognizedSelectionSlot(
  snapshot: ProjectGraphSnapshot,
  target: Extract<RerunTarget, { kind: "selection" }>
): boolean {
  if (target.slotOwnerLineageId !== null) {
    return snapshot.assets.some((asset) =>
      asset.lineageId === target.slotOwnerLineageId) &&
      ASSET_OWNED_SELECTION_ROLES.has(target.slotRole);
  }
  if (PROJECT_SELECTION_ROLES.has(target.slotRole)) return true;
  const [prefix, stableId, extra] = target.slotRole.split(":");
  if (!stableId || extra !== undefined) return false;
  if (["beat_keyframe", "beat_clip", "voiceover", "audio_fit"].includes(prefix)) {
    return snapshot.beats.some((beat) => beat.id === stableId);
  }
  if (prefix === "scene_anchor") {
    return snapshot.scenes.some((scene) => scene.id === stableId);
  }
  return false;
}

function boundedParams(value: Record<string, unknown>): Record<string, unknown> {
  const serialized = JSON.stringify(value);
  if (serialized.length <= RERUN_CONTEXT_LIMITS.actionParamsChars) return value;
  return {
    truncated: true,
    preview: serialized.slice(0, RERUN_CONTEXT_LIMITS.actionParamsChars),
  };
}

function assertAuthorizedTargets(input: BuildRerunDecisionPacketInput, targets: RerunTarget[]) {
  const { snapshot } = input;
  const assetIds = new Set(snapshot.assets.map((asset) => asset.id));
  const lineageIds = new Set(snapshot.assets.map((asset) => asset.lineageId));
  const storyboardIds = new Set(snapshot.storyboards.map((row) => row.id));
  const sceneIds = new Set(snapshot.scenes.map((row) => row.id));
  const beatIds = new Set(snapshot.beats.map((row) => row.id));
  const panelIds = new Set(snapshot.panels.map((row) => row.id));
  const timelineItemsById = new Map(
    (input.timelineItems ?? []).map((row) => [row.id, row])
  );
  const transcriptSegmentsById = new Map(
    (input.transcriptSegments ?? []).map((row) => [row.id, row])
  );
  const authorizedTimelineItemIds = new Set(
    [...timelineItemsById.values()]
      .filter((row) =>
        input.timelineAssetId != null &&
        assetIds.has(input.timelineAssetId) &&
        assetIds.has(row.clipAssetId))
      .map((row) => row.id)
  );
  const authorizedTranscriptSegmentIds = new Set(
    [...transcriptSegmentsById.values()]
      .filter((row) => assetIds.has(row.transcriptAssetId))
      .map((row) => row.id)
  );
  const selectionIds = new Set(
    snapshot.selections.map((selection) =>
      `${selection.slotOwnerLineageId ?? "project"}:${selection.slotRole}`)
  );
  for (const target of targets) {
    if (target.projectId !== snapshot.projectId) {
      throw new ApiError("validation_failed", "Every rerun target must belong to the path project.");
    }
    const exists =
      target.kind === "project" ||
      (target.kind === "asset" && assetIds.has(target.assetId)) ||
      (target.kind === "lineage" && lineageIds.has(target.lineageId)) ||
      (target.kind === "storyboard" && storyboardIds.has(target.storyboardId)) ||
      (target.kind === "scene" && sceneIds.has(target.sceneId)) ||
      (target.kind === "beat" && beatIds.has(target.beatId)) ||
      (target.kind === "panel" && panelIds.has(target.panelId)) ||
      (target.kind === "selection" &&
        (selectionIds.has(`${target.slotOwnerLineageId ?? "project"}:${target.slotRole}`) ||
          isServerRecognizedSelectionSlot(snapshot, target))) ||
      (target.kind === "timeline_item" &&
        authorizedTimelineItemIds.has(target.timelineItemId)) ||
      (target.kind === "transcript_segment" &&
        authorizedTranscriptSegmentIds.has(target.transcriptSegmentId)) ||
      (target.kind === "export" && assetIds.has(target.exportId));
    if (!exists) {
      throw new ApiError("validation_failed", `Rerun target is not authorized: ${targetKey(target)}`);
    }
  }
}

function targetAssetIds(input: BuildRerunDecisionPacketInput, targets: RerunTarget[]): string[] {
  const { snapshot } = input;
  const ids: string[] = [];
  // Reserve backing assets for explicit targets before a broad project target
  // fills the inspected-asset budget.
  const orderedTargets = [
    ...targets.filter((target) => target.kind !== "project"),
    ...targets.filter((target) => target.kind === "project"),
  ];
  for (const target of orderedTargets) {
    if (target.kind === "project") {
      ids.push(
        ...(input.timelineAssetId ? [input.timelineAssetId] : []),
        ...(input.timelineItems ?? []).map((row) => row.clipAssetId),
        ...(input.transcriptSegments ?? []).map((row) => row.transcriptAssetId),
        ...snapshot.selections.map((selection) => selection.activeAssetId),
        ...(snapshot.storyBlueprint?.assetId ? [snapshot.storyBlueprint.assetId] : []),
        ...(snapshot.storyBlueprint?.briefAssetId ? [snapshot.storyBlueprint.briefAssetId] : []),
        ...snapshot.storyboards.flatMap((row) => row.planAssetId ? [row.planAssetId] : []),
        ...snapshot.scenes.flatMap((row) => row.sceneAssetId ? [row.sceneAssetId] : []),
        ...snapshot.beats.flatMap((row) => row.beatAssetId ? [row.beatAssetId] : []),
        ...snapshot.panels.flatMap((row) =>
          [row.imageAssetId, row.promptAssetId].filter((id): id is string => Boolean(id)))
      );
    }
    if (target.kind === "asset") ids.push(target.assetId);
    if (target.kind === "lineage") {
      ids.push(...snapshot.assets.filter((asset) => asset.lineageId === target.lineageId).map((asset) => asset.id));
    }
    if (target.kind === "storyboard") {
      const row = snapshot.storyboards.find((candidate) => candidate.id === target.storyboardId);
      if (row?.planAssetId) ids.push(row.planAssetId);
    }
    if (target.kind === "scene") {
      const row = snapshot.scenes.find((candidate) => candidate.id === target.sceneId);
      if (row?.sceneAssetId) ids.push(row.sceneAssetId);
    }
    if (target.kind === "beat") {
      const row = snapshot.beats.find((candidate) => candidate.id === target.beatId);
      if (row?.beatAssetId) ids.push(row.beatAssetId);
    }
    if (target.kind === "panel") {
      const row = snapshot.panels.find((candidate) => candidate.id === target.panelId);
      if (row?.imageAssetId) ids.push(row.imageAssetId);
      if (row?.promptAssetId) ids.push(row.promptAssetId);
    }
    if (target.kind === "selection") {
      const row = snapshot.selections.find((candidate) =>
        candidate.slotOwnerLineageId === target.slotOwnerLineageId &&
        candidate.slotRole === target.slotRole);
      if (row) ids.push(row.activeAssetId);
    }
    if (target.kind === "timeline_item") {
      const row = input.timelineItems?.find((candidate) => candidate.id === target.timelineItemId);
      if (input.timelineAssetId) ids.push(input.timelineAssetId);
      if (row) {
        ids.push(row.clipAssetId);
        const beat = row.beatId
          ? snapshot.beats.find((candidate) => candidate.id === row.beatId)
          : undefined;
        if (beat?.beatAssetId) ids.push(beat.beatAssetId);
      }
    }
    if (target.kind === "transcript_segment") {
      const row = input.transcriptSegments?.find(
        (candidate) => candidate.id === target.transcriptSegmentId
      );
      if (row) ids.push(row.transcriptAssetId);
    }
    if (target.kind === "export") ids.push(target.exportId);
  }
  return [...new Set(ids)];
}

function collectGraphNeighborhood(snapshot: ProjectGraphSnapshot, seedIds: string[]) {
  const byId = new Map(snapshot.assets.map((asset) => [asset.id, asset]));
  const consumers = new Map<string, string[]>();
  for (const asset of snapshot.assets) {
    for (const graphInput of asset.inputs) {
      const ids = consumers.get(graphInput.assetId) ?? [];
      ids.push(asset.id);
      consumers.set(graphInput.assetId, ids);
    }
  }
  const upstream = new Set<string>();
  const upstreamQueue = [...seedIds];
  while (upstreamQueue.length > 0 && upstream.size < RERUN_CONTEXT_LIMITS.inspectedAssets) {
    const id = upstreamQueue.shift()!;
    const asset = byId.get(id);
    for (const graphInput of asset?.inputs ?? []) {
      if (seedIds.includes(graphInput.assetId) || upstream.has(graphInput.assetId)) continue;
      upstream.add(graphInput.assetId);
      upstreamQueue.push(graphInput.assetId);
    }
  }
  const downstreamDepth = new Map<string, number>();
  const downstreamQueue = seedIds.map((id) => ({ id, depth: 0 }));
  while (downstreamQueue.length > 0 &&
         downstreamDepth.size < RERUN_CONTEXT_LIMITS.downstreamCandidates + 1) {
    const current = downstreamQueue.shift()!;
    for (const consumerId of consumers.get(current.id) ?? []) {
      if (seedIds.includes(consumerId) || downstreamDepth.has(consumerId)) continue;
      downstreamDepth.set(consumerId, current.depth + 1);
      downstreamQueue.push({ id: consumerId, depth: current.depth + 1 });
    }
  }
  const lineages = new Set(seedIds.flatMap((id) => {
    const lineage = byId.get(id)?.lineageId;
    return lineage ? [lineage] : [];
  }));
  const lineage = new Set(snapshot.assets.filter((asset) => lineages.has(asset.lineageId)).map((asset) => asset.id));
  const sibling = new Set<string>();
  const relatedStoryIds = new Set([
    ...snapshot.scenes.flatMap((scene) => seedIds.includes(scene.sceneAssetId ?? "") ? [scene.id] : []),
    ...snapshot.beats.flatMap((beat) => seedIds.includes(beat.beatAssetId ?? "") ? [beat.sceneId, beat.id] : []),
  ]);
  for (const asset of snapshot.assets) {
    if (asset.inputs.some((graphInput) => seedIds.includes(graphInput.assetId)) ||
        asset.inputs.some((graphInput) => upstream.has(graphInput.assetId)) ||
        asset.inputs.some((graphInput) => relatedStoryIds.has(graphInput.role ?? ""))) {
      sibling.add(asset.id);
    }
  }
  return { byId, upstream, downstreamDepth, lineage, sibling };
}

export function buildRerunDecisionPacket(input: BuildRerunDecisionPacketInput): RerunDecisionPacket {
  if (input.rootRun && (
    input.rootRun.projectId !== input.snapshot.projectId ||
    input.rootRun.agentRole !== "creative_director" ||
    !["queued", "running", "waiting"].includes(input.rootRun.status)
  )) {
    throw new ApiError("validation_failed", "rootRunId must be a Creative Director root for this project.");
  }
  const targets = dedupe(input.targets, targetKey);
  if (targets.length === 0 || targets.length > RERUN_CONTEXT_LIMITS.targets) {
    throw new ApiError("validation_failed", "Rerun proposals require between 1 and 20 unique targets.");
  }
  const semanticCandidates = semanticRowsForTargets(input, targets);
  const boundedInput: BuildRerunDecisionPacketInput = {
    ...input,
    timelineItems: semanticCandidates.timelineItems.values,
    transcriptSegments: semanticCandidates.transcriptSegments.values,
  };
  assertAuthorizedTargets(boundedInput, targets);
  const seeds = targetAssetIds(boundedInput, targets);
  const graph = collectGraphNeighborhood(input.snapshot, seeds);
  const downstream = bounded(
    [...graph.downstreamDepth.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])),
    RERUN_CONTEXT_LIMITS.downstreamCandidates
  );
  const relatedIds = [...new Set([...graph.lineage, ...graph.sibling])]
    .filter((id) => !seeds.includes(id) && !graph.downstreamDepth.has(id))
    .sort();
  const related = bounded(relatedIds, RERUN_CONTEXT_LIMITS.relatedAssets);
  const orderedIds = [...new Set([
    ...seeds,
    ...graph.upstream,
    ...downstream.values.map(([id]) => id),
    ...related.values,
  ])];
  const inspected = bounded(orderedIds, RERUN_CONTEXT_LIMITS.inspectedAssets);
  const seedSet = new Set(seeds);
  const downstreamMap = new Map(downstream.values);
  const selectionByAsset = new Map<string, ProjectGraphSnapshot["selections"]>();
  for (const selection of input.snapshot.selections) {
    const refs = selectionByAsset.get(selection.activeAssetId) ?? [];
    refs.push(selection);
    selectionByAsset.set(selection.activeAssetId, refs);
  }
  let assetInputsTruncated = false;
  let selectionRefsTruncated = false;
  const assets = inspected.values.flatMap((id) => {
    const asset = graph.byId.get(id);
    if (!asset) return [];
    const relationToTarget: RerunDecisionPacket["assets"][number]["relationToTarget"] = seedSet.has(id)
      ? "target"
      : graph.upstream.has(id)
        ? "upstream"
        : downstreamMap.has(id)
          ? "downstream"
          : graph.lineage.has(id)
            ? "lineage"
            : "sibling";
    const uniqueInputs = dedupe(asset.inputs, (graphInput) =>
      [
        graphInput.assetId,
        graphInput.relation,
        graphInput.role ?? "",
        graphInput.position ?? "",
        graphInput.contentHash ?? "",
      ].join(":"));
    const boundedInputs = bounded(uniqueInputs, RERUN_CONTEXT_LIMITS.inputsPerAsset);
    assetInputsTruncated ||= boundedInputs.truncated;
    const uniqueSelectionRefs = dedupe(selectionByAsset.get(id) ?? [], (selection) =>
      `${selection.slotOwnerLineageId ?? "project"}:${selection.slotRole}`);
    const boundedSelectionRefs = bounded(
      uniqueSelectionRefs,
      RERUN_CONTEXT_LIMITS.selectionRefsPerAsset
    );
    selectionRefsTruncated ||= boundedSelectionRefs.truncated;
    return [{
      id,
      kind: asset.kind,
      role: asset.role ?? null,
      name: compactText(asset.name),
      description: compactText(asset.description),
      durationSec: asset.durationSec ?? null,
      lineageId: asset.lineageId,
      version: asset.version,
      contentHash: asset.contentHash ?? null,
      inputsFingerprint: asset.inputsFingerprint ?? null,
      inputs: boundedInputs.values,
      selectionRefs: boundedSelectionRefs.values.map((selection) => ({
        slotOwnerLineageId: selection.slotOwnerLineageId,
        slotRole: selection.slotRole,
        seq: selection.seq,
      })),
      relationToTarget,
      depth: downstreamMap.get(id) ?? null,
    }];
  });
  const actionsRaw = input.recentActions ?? [];
  const actions = bounded(actionsRaw.slice().reverse(), RERUN_CONTEXT_LIMITS.actions);
  const reports = bounded(
    actionsRaw
      .filter((action) => action.tool === "domain_report" && action.status === "applied")
      .slice()
      .reverse(),
    RERUN_CONTEXT_LIMITS.terminalReports
  );
  const storyBudget = RERUN_CONTEXT_LIMITS.storyRows;
  type StoryEntry =
    | { kind: "storyboard"; id: string }
    | { kind: "scene"; id: string }
    | { kind: "beat"; id: string }
    | { kind: "panel"; id: string };
  const storyEntryKey = (entry: StoryEntry) => `${entry.kind}:${entry.id}`;
  const explicitStoryEntries: StoryEntry[] = targets.flatMap((target) => {
    if (target.kind === "storyboard") {
      return [{ kind: "storyboard" as const, id: target.storyboardId }];
    }
    if (target.kind === "scene") {
      const scene = input.snapshot.scenes.find((row) => row.id === target.sceneId);
      return [
        { kind: "scene" as const, id: target.sceneId },
        ...(scene ? [{ kind: "storyboard" as const, id: scene.storyboardId }] : []),
      ];
    }
    if (target.kind === "beat") {
      const beat = input.snapshot.beats.find((row) => row.id === target.beatId);
      const scene = beat
        ? input.snapshot.scenes.find((row) => row.id === beat.sceneId)
        : undefined;
      return [
        { kind: "beat" as const, id: target.beatId },
        ...(beat ? [{ kind: "scene" as const, id: beat.sceneId }] : []),
        ...(scene ? [{ kind: "storyboard" as const, id: scene.storyboardId }] : []),
      ];
    }
    if (target.kind === "panel") {
      const panel = input.snapshot.panels.find((row) => row.id === target.panelId);
      const beat = panel
        ? input.snapshot.beats.find((row) => row.id === panel.beatId)
        : undefined;
      const scene = beat
        ? input.snapshot.scenes.find((row) => row.id === beat.sceneId)
        : undefined;
      return [
        { kind: "panel" as const, id: target.panelId },
        ...(panel ? [{ kind: "beat" as const, id: panel.beatId }] : []),
        ...(beat ? [{ kind: "scene" as const, id: beat.sceneId }] : []),
        ...(scene ? [{ kind: "storyboard" as const, id: scene.storyboardId }] : []),
      ];
    }
    return [];
  });
  const allStoryEntries: StoryEntry[] = [
    ...input.snapshot.storyboards.map((row) => ({ kind: "storyboard" as const, id: row.id })),
    ...input.snapshot.scenes.map((row) => ({ kind: "scene" as const, id: row.id })),
    ...input.snapshot.beats.map((row) => ({ kind: "beat" as const, id: row.id })),
    ...input.snapshot.panels.map((row) => ({ kind: "panel" as const, id: row.id })),
  ];
  const selectedStoryEntries = bounded(
    dedupe([...explicitStoryEntries, ...allStoryEntries], storyEntryKey),
    storyBudget
  );
  const selectedStoryKeys = new Set(selectedStoryEntries.values.map(storyEntryKey));
  const storyboards = input.snapshot.storyboards.filter((row) =>
    selectedStoryKeys.has(`storyboard:${row.id}`));
  const scenes = input.snapshot.scenes
    .filter((row) => selectedStoryKeys.has(`scene:${row.id}`))
    .map((scene) => ({
      ...scene,
      ...(scene.title ? { title: scene.title.slice(0, RERUN_CONTEXT_LIMITS.summaryText) } : {}),
      ...(scene.summary
        ? { summary: scene.summary.slice(0, RERUN_CONTEXT_LIMITS.summaryText) }
        : {}),
    }));
  const beats = input.snapshot.beats
    .filter((row) => selectedStoryKeys.has(`beat:${row.id}`))
    .map((beat) => ({
      ...beat,
      intent: beat.intent.slice(0, RERUN_CONTEXT_LIMITS.summaryText),
      ...(beat.visualDescription
        ? { visualDescription: beat.visualDescription.slice(0, RERUN_CONTEXT_LIMITS.summaryText) }
        : {}),
      ...(beat.dialogueSummary
        ? { dialogueSummary: beat.dialogueSummary.slice(0, RERUN_CONTEXT_LIMITS.summaryText) }
        : {}),
      ...(beat.narration
        ? { narration: beat.narration.slice(0, RERUN_CONTEXT_LIMITS.summaryText) }
        : {}),
    }));
  const panels = input.snapshot.panels.filter((row) =>
    selectedStoryKeys.has(`panel:${row.id}`));
  const allStorySnapshots: StorySnapshotPin[] = [
    ...(input.snapshot.storyBlueprint ? [{
      rowKind: "story_blueprint" as const,
      rowId: input.snapshot.storyBlueprint.id,
      expectedSnapshotAssetId: input.snapshot.storyBlueprint.assetId,
    }] : []),
    ...input.snapshot.storyboards.map((storyboard) => ({
      rowKind: "storyboard" as const,
      rowId: storyboard.id,
      expectedSnapshotAssetId: storyboard.planAssetId,
    })),
    ...input.snapshot.scenes.map((scene) => ({
      rowKind: "story_scene" as const,
      rowId: scene.id,
      expectedSnapshotAssetId: scene.sceneAssetId,
    })),
    ...input.snapshot.beats.map((beat) => ({
      rowKind: "story_beat" as const,
      rowId: beat.id,
      expectedSnapshotAssetId: beat.beatAssetId,
    })),
  ];
  const storySnapshotsByKey = new Map(
    allStorySnapshots.map((pin) => [storyPinKey(pin), pin])
  );
  const explicitStoryPinKeys = targets
    .map(targetStoryPinKey)
    .filter((key): key is string => key !== null);
  const explicitStoryPins = explicitStoryPinKeys.map((key) => {
    const pin = storySnapshotsByKey.get(key);
    if (!pin) {
      throw new ApiError(
        "validation_failed",
        `Requested story target is missing its canonical pointer pin: ${key}.`
      );
    }
    return pin;
  });
  const storySnapshots = bounded(dedupe([
    ...explicitStoryPins,
    ...allStorySnapshots,
  ], storyPinKey), RERUN_CONTEXT_LIMITS.storyRows);
  const allSelectionPins: RerunDecisionPacket["pins"]["selections"] = dedupe(
    input.snapshot.selections
      .filter((selection) => inspected.values.includes(selection.activeAssetId))
      .map((selection) => ({
        slotOwnerLineageId: selection.slotOwnerLineageId,
        slotRole: selection.slotRole,
        expectedActiveAssetId: selection.activeAssetId,
        expectedSeq: selection.seq,
      })),
    (pin) =>
      `${pin.slotOwnerLineageId ?? "project"}:${pin.slotRole}`);
  const selectionPinKey = (pin: RerunDecisionPacket["pins"]["selections"][number]) =>
    `${pin.slotOwnerLineageId ?? "project"}:${pin.slotRole}`;
  const selectionPinsByKey = new Map(allSelectionPins.map((pin) => [selectionPinKey(pin), pin]));
  const explicitSelectionPins: RerunDecisionPacket["pins"]["selections"] = targets.flatMap(
    (target) => {
      if (target.kind !== "selection") return [];
      const key = `${target.slotOwnerLineageId ?? "project"}:${target.slotRole}`;
      const pin = selectionPinsByKey.get(key);
      if (pin) return [pin];
      if (!isServerRecognizedSelectionSlot(input.snapshot, target)) {
        throw new ApiError("validation_failed", `Requested selection target is invalid: ${key}.`);
      }
      return [{
        slotOwnerLineageId: target.slotOwnerLineageId,
        slotRole: target.slotRole,
        expectedActiveAssetId: null,
        expectedSeq: 0,
      }];
    }
  );
  const selectionPins = bounded(dedupe([
    ...explicitSelectionPins,
    ...allSelectionPins,
  ], selectionPinKey), RERUN_CONTEXT_LIMITS.selectionPins);
  const inspectedIds = new Set(assets.map((asset) => asset.id));
  const timelineItems = semanticCandidates.timelineItems.values.filter((row) =>
    input.timelineAssetId != null &&
    inspectedIds.has(input.timelineAssetId) &&
    inspectedIds.has(row.clipAssetId));
  const transcriptSegments = semanticCandidates.transcriptSegments.values.filter((row) =>
    inspectedIds.has(row.transcriptAssetId));
  return {
    schemaVersion: "RerunDecisionPacket.v1",
    projectId: input.snapshot.projectId,
    rootRun: {
      id: input.rootRun?.id ?? null,
      status: input.rootRun?.status ?? "unbound",
      spentUsd: input.rootRun?.spentUsd ?? 0,
      budgetUsd: input.rootRun?.budgetUsd ?? null,
    },
    userIntent: input.userIntent,
    targets,
    assets,
    candidateAffectedAssetIds: downstream.values.map(([id]) => id),
    relatedAssetIds: related.values,
    story: {
      blueprint: input.snapshot.storyBlueprint,
      storyboards,
      scenes,
      beats,
      panels,
    },
    timelineItems,
    transcriptSegments,
    recentActions: actions.values.map((action) => ({
      id: action.id,
      tool: action.tool,
      status: action.status,
      outputAssetIds: action.outputAssetIds,
      params: boundedParams(action.params),
      ...(action.rationale
        ? { rationale: action.rationale.slice(0, RERUN_CONTEXT_LIMITS.summaryText) }
        : {}),
      ...(action.error ? { error: boundedParams(action.error) } : {}),
    })),
    terminalDomainReports: reports.values
      .map((action) => ({ id: action.id, params: boundedParams(action.params) })),
    capabilities: TOOL_NAMES.map((name) => {
      const capability = getToolCapability(name);
      return {
        name,
        owner: capability.ownerRole,
        capability: capability.capability,
        costClass: capability.costClass,
      };
    }),
    pins: {
      assets: assets.map((asset) => ({
        assetId: asset.id,
        contentHash: asset.contentHash,
        inputsFingerprint: asset.inputsFingerprint,
      })),
      selections: selectionPins.values,
      storySnapshots: storySnapshots.values,
    },
    truncation: {
      assets: inspected.truncated,
      downstreamCandidates: downstream.truncated,
      relatedAssets: related.truncated,
      actions: actions.truncated,
      terminalReports: reports.truncated,
      storyRows: selectedStoryEntries.truncated || storySnapshots.truncated,
      timelineItems:
        semanticCandidates.timelineItems.truncated ||
        timelineItems.length < semanticCandidates.timelineItems.values.length,
      transcriptSegments:
        semanticCandidates.transcriptSegments.truncated ||
        transcriptSegments.length < semanticCandidates.transcriptSegments.values.length,
      assetInputs: assetInputsTruncated,
      selectionRefs: selectionRefsTruncated,
      selectionPins: selectionPins.truncated,
    },
  };
}

export function canonicalTimelineItemIds(value: unknown): Set<string> {
  return new Set(canonicalTimelineItems(value).map((row) => row.id));
}

export function canonicalTimelineItems(value: unknown): RerunTimelineItem[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const segments = (value as { segments?: unknown }).segments;
  if (!Array.isArray(segments)) return [];
  return segments.flatMap((segment) => {
    if (!segment || typeof segment !== "object" || Array.isArray(segment)) return [];
    const row = segment as Record<string, unknown>;
    const id = row.id;
    const clipAssetId = row.clipId;
    if (typeof id !== "string" || id.length === 0 || id.length > 128 ||
        typeof clipAssetId !== "string" || clipAssetId.length === 0 ||
        clipAssetId.length > 200) {
      return [];
    }
    const numberOrNull = (candidate: unknown) =>
      typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
    const textOrNull = (candidate: unknown) =>
      typeof candidate === "string" ? compactText(candidate) : null;
    return [{
      id,
      clipAssetId,
      beatId: typeof row.beatId === "string" ? row.beatId : null,
      sourceInSec: numberOrNull(row.sourceInSec),
      sourceOutSec: numberOrNull(row.sourceOutSec),
      role: textOrNull(row.role),
      reason: textOrNull(row.reason),
      caption: textOrNull(row.caption),
    }];
  });
}

export async function loadRerunDecisionPacket(input: {
  workspaceId: string;
  projectId: string;
  rootRunId?: string;
  targets: RerunTarget[];
  userIntent: string;
}): Promise<RerunDecisionPacket> {
  const snapshot = await loadProjectGraphSnapshot({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
  });
  const recentRunIds = [...new Set([
    ...(input.rootRunId ? [input.rootRunId] : []),
    ...snapshot.runs
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10)
      .map((run) => run.id),
  ])];
  const [rootRun, actions, timeline, transcriptSegments, canonicalStory] = await Promise.all([
    input.rootRunId ? getOrchestratorRun(input.rootRunId) : Promise.resolve(null),
    Promise.all(recentRunIds.map((runId) => listRunActions(runId))).then((actionLists) => {
      const byId = new Map(actionLists.flat().map((action) => [action.id, action]));
      return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }),
    getActiveProjectTimelineAsset({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    }),
    listTranscriptSegments(
      input.projectId,
      input.targets.flatMap((target) =>
        target.kind === "transcript_segment" ? [target.transcriptSegmentId] : [])
    ),
    getProjectStoryboard(input.workspaceId, input.projectId),
  ]);
  // The shared graph snapshot still carries legacy storyboard compatibility
  // rows for existing agent projections. Proposal decisioning replaces those
  // rows with the live story_blueprints -> story_blueprint_scenes ->
  // story_beats -> story_panels spine before target authorization or pinning.
  const canonicalSnapshot: ProjectGraphSnapshot = canonicalStory
    ? {
        ...snapshot,
        storyboards: [{
          id: canonicalStory.id,
          projectId: canonicalStory.projectId,
          status: canonicalStory.status,
          planAssetId: canonicalStory.planAssetId,
        }],
        scenes: canonicalStory.scenes.map((scene) => ({
          id: scene.id,
          projectId: scene.projectId,
          storyboardId: scene.storyboardId,
          sceneIndex: scene.sceneIndex,
          ...(scene.title ? { title: scene.title } : {}),
          ...(scene.summary ? { summary: scene.summary } : {}),
          ...(scene.durationSec != null ? { durationSec: scene.durationSec } : {}),
          sceneAssetId: scene.sceneAssetId,
          status: scene.status,
        })),
        beats: canonicalStory.scenes.flatMap((scene) => scene.beats.map((beat) => ({
          id: beat.id,
          projectId: beat.projectId,
          sceneId: beat.sceneId,
          beatIndex: beat.beatIndex,
          intent: beat.intent,
          ...(beat.visualDescription ? { visualDescription: beat.visualDescription } : {}),
          ...(beat.dialogueSummary ? { dialogueSummary: beat.dialogueSummary } : {}),
          ...(beat.narration ? { narration: beat.narration } : {}),
          ...(beat.durationSec != null ? { durationSec: beat.durationSec } : {}),
          status: beat.status,
          beatAssetId: beat.beatAssetId,
        }))),
        panels: canonicalStory.scenes.flatMap((scene) => scene.beats.flatMap((beat) =>
          beat.panels.map((panel) => ({
            id: panel.id,
            projectId: panel.projectId,
            beatId: panel.beatId,
            panelIndex: panel.panelIndex,
            imageAssetId: panel.imageAssetId,
            promptAssetId: panel.promptAssetId,
            status: panel.status,
            isSelected: panel.isSelected,
            ...(panel.approvedAt ? { approvedAt: panel.approvedAt } : {}),
          }))
        )),
      }
    : { ...snapshot, storyboards: [], scenes: [], beats: [], panels: [] };
  return buildRerunDecisionPacket({
    snapshot: canonicalSnapshot,
    rootRun,
    targets: input.targets,
    userIntent: input.userIntent,
    ...(timeline ? {
      timelineAssetId: timeline.assetId,
      timelineItems: canonicalTimelineItems(timeline.timeline),
    } : {}),
    transcriptSegments,
    recentActions: actions,
  });
}

async function listTranscriptSegments(
  projectId: string,
  explicitSegmentIds: string[]
): Promise<RerunTranscriptSegment[]> {
  const db = getServiceSupabase();
  const columns = "id, transcript_asset_id, position, start_sec, end_sec, text, speaker";
  const [explicitRows, remainderRows] = await Promise.all([
    explicitSegmentIds.length > 0
      ? runQuery(
        "rerunDecisionContext.listTranscriptSegments explicit",
        db
          .from("transcript_segments")
          .select(columns)
          .eq("project_id", projectId)
          .in("id", explicitSegmentIds)
      )
      : Promise.resolve([]),
    runQuery(
      "rerunDecisionContext.listTranscriptSegments remainder",
      db
        .from("transcript_segments")
        .select(columns)
        .eq("project_id", projectId)
        .order("position", { ascending: true })
        .limit(500)
    ),
  ]);
  type TranscriptSegmentRow = {
    id: string;
    transcript_asset_id: string;
    position: number;
    start_sec: number;
    end_sec: number;
    text: string;
    speaker: string | null;
  };
  const rows = dedupe(
    [...(explicitRows ?? []), ...(remainderRows ?? [])] as TranscriptSegmentRow[],
    (row) => row.id
  );
  return rows.map((row) => ({
    id: row.id,
    transcriptAssetId: row.transcript_asset_id,
    position: row.position,
    startSec: row.start_sec,
    endSec: row.end_sec,
    text: row.text.slice(0, RERUN_CONTEXT_LIMITS.summaryText),
    speaker: compactText(row.speaker ?? undefined),
  }));
}
