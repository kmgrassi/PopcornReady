import type { DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";
import type { ProjectGraphSnapshot } from "@/lib/orchestrator-context/graph-snapshot";
import {
  assertScopedPrimitiveInput,
  isAssetInTargetScope,
  type DomainTargetScope,
} from "@/lib/orchestrator-context/target-scope";

import type { ToolName } from "./capability-catalog";
import { ToolInputError } from "./types";

const PRODUCTION_VISUAL_TOOLS = new Set<ToolName>([
  "generate_anchor",
  "generate_storyboard",
  "generate_keyframe",
  "generate_clip",
  "regenerate_image_asset",
  "edit_video_asset",
]);

function selectiveVideoToolNames(
  task: DomainTaskV1
): readonly ToolName[] | null {
  const bound = task.requiredOutputs.filter(
    (output) => output.kind === "clip" && output.target
  );
  if (bound.length === 0 || bound.length !== task.requiredOutputs.length) {
    return null;
  }
  if (bound.every((output) => output.target?.kind === "asset")) {
    return ["edit_video_asset"];
  }
  if (bound.every((output) => output.target?.kind === "project")) {
    return ["generate_video_asset"];
  }
  if (
    bound.every(
      (output) =>
        output.target?.kind === "beat" ||
        (
          output.target?.kind === "selection" &&
          output.target.slotRole.startsWith("beat_clip:")
        )
    )
  ) {
    return ["generate_clip"];
  }
  return [];
}

export function allowedVisualToolNames(task: DomainTaskV1): readonly ToolName[] {
  if (task.domain !== "visuals") return [];
  if (task.taskKind === "image_create") return ["generate_image_asset"];
  if (task.taskKind === "video_create") return ["generate_video_asset"];
  if (task.taskKind === "video_edit") return ["edit_video_asset"];
  if (task.taskKind === "visuals_revision") {
    const videoTools = selectiveVideoToolNames(task);
    if (videoTools) return videoTools;
    return [...PRODUCTION_VISUAL_TOOLS, "generate_video_asset"];
  }
  return [...PRODUCTION_VISUAL_TOOLS];
}

function requireOutput(task: DomainTaskV1, kind: "image" | "clip"): void {
  if (!(task.allowedOutputKinds as readonly string[]).includes(kind)) {
    throw new ToolInputError(`The trusted ${task.taskKind} assignment does not allow ${kind} output.`);
  }
}

function requireVisualOutput(
  task: DomainTaskV1,
  kind: "image" | "anchor" | "keyframe" | "clip"
): void {
  if (!(task.allowedOutputKinds as readonly string[]).includes(kind)) {
    throw new ToolInputError(
      `${kind} output is outside the trusted ${task.taskKind} assignment.`
    );
  }
}

function assertPinnedVideoSource(input: {
  task: DomainTaskV1;
  scope: DomainTargetScope;
  snapshot: ProjectGraphSnapshot;
  sourceAssetId: string;
}): void {
  const { task, scope, snapshot, sourceAssetId } = input;
  const isAssetTarget = task.targets.some(
    (target) => target.kind === "asset" && target.assetId === sourceAssetId
  );
  const isPinned = task.preserve.pins.some(
    (pin) => pin.kind === "asset" && pin.id === sourceAssetId
  );
  const fingerprint = task.preserve.fingerprints.find(
    (pin) => pin.assetId === sourceAssetId
  );
  const asset = snapshot.assets.find((candidate) => candidate.id === sourceAssetId);
  if (
    !isAssetTarget ||
    !isPinned ||
    !fingerprint ||
    !asset?.contentHash ||
    asset.contentHash !== fingerprint.value ||
    !isAssetInTargetScope(scope, sourceAssetId)
  ) {
    throw new ToolInputError(
      "edit_video_asset requires a current, authorized, pinned source asset."
    );
  }
}

function targetedBeatIds(
  task: DomainTaskV1,
  snapshot: ProjectGraphSnapshot
): { beatIds: string[]; sceneIds: string[] } | null {
  if (task.targets.some((target) => target.kind === "project")) return null;

  const beatIds = new Set<string>();
  const sceneIds = new Set<string>();
  const targetedAssetIds = new Set<string>();
  const targetedLineageIds = new Set<string>();

  for (const target of task.targets) {
    if (target.kind === "storyboard") {
      for (const scene of snapshot.scenes.filter(
        (candidate) => candidate.storyboardId === target.storyboardId
      )) {
        sceneIds.add(scene.id);
      }
    } else if (target.kind === "scene") {
      sceneIds.add(target.sceneId);
    } else if (target.kind === "beat") {
      beatIds.add(target.beatId);
    } else if (target.kind === "panel") {
      const panel = snapshot.panels.find((candidate) => candidate.id === target.panelId);
      if (panel) beatIds.add(panel.beatId);
    } else if (target.kind === "asset") {
      targetedAssetIds.add(target.assetId);
    } else if (target.kind === "lineage") {
      targetedLineageIds.add(target.lineageId);
    } else if (
      target.kind === "selection" &&
      target.slotRole.startsWith("beat_clip:")
    ) {
      const beatId = target.slotRole.slice("beat_clip:".length);
      if (beatId) beatIds.add(beatId);
    }
  }

  for (const asset of snapshot.assets) {
    if (targetedLineageIds.has(asset.lineageId)) targetedAssetIds.add(asset.id);
  }
  for (const panel of snapshot.panels) {
    if (
      (panel.imageAssetId && targetedAssetIds.has(panel.imageAssetId)) ||
      (panel.promptAssetId && targetedAssetIds.has(panel.promptAssetId))
    ) {
      beatIds.add(panel.beatId);
    }
  }
  for (const beat of snapshot.beats) {
    if (beat.beatAssetId && targetedAssetIds.has(beat.beatAssetId)) beatIds.add(beat.id);
    if (sceneIds.has(beat.sceneId)) beatIds.add(beat.id);
  }
  for (const selection of snapshot.selections) {
    if (!targetedAssetIds.has(selection.activeAssetId)) continue;
    const match = /^(?:beat_keyframe|beat_storyboard|beat_clip):(.+)$/.exec(
      selection.slotRole
    );
    if (match?.[1]) beatIds.add(match[1]);
  }
  for (const beatId of beatIds) {
    const beat = snapshot.beats.find((candidate) => candidate.id === beatId);
    if (beat) sceneIds.add(beat.sceneId);
  }
  return { beatIds: [...beatIds], sceneIds: [...sceneIds] };
}

/**
 * Side-effect-free domain authorization over one already parsed tool input.
 * Trusted target filters are added to the canonical prepared value; the model
 * never supplies these internal fields.
 */
export function assertPreparedDomainToolInput(input: {
  toolName: ToolName;
  parsedInput: unknown;
  task: DomainTaskV1;
  scope: DomainTargetScope;
  snapshot: ProjectGraphSnapshot;
}): unknown {
  const { toolName, task, scope, snapshot } = input;
  if (!allowedVisualToolNames(task).includes(toolName)) {
    throw new ToolInputError(`${toolName} is not allowed for ${task.taskKind}.`);
  }
  if (
    typeof input.parsedInput !== "object" ||
    input.parsedInput === null ||
    Array.isArray(input.parsedInput)
  ) {
    throw new ToolInputError(`${toolName} input must be an object.`);
  }
  const parsed = input.parsedInput as Record<string, unknown>;
  assertScopedPrimitiveInput(scope, parsed);

  if (toolName === "generate_image_asset") requireOutput(task, "image");
  if (toolName === "generate_video_asset" || toolName === "edit_video_asset") {
    requireOutput(task, "clip");
  }
  if (
    task.taskKind === "visuals_revision" &&
    (
      toolName === "generate_clip" ||
      toolName === "generate_video_asset" ||
      toolName === "edit_video_asset"
    ) &&
    (parsed.provider || parsed.model)
  ) {
    throw new ToolInputError(
      "Selective video work derives provider settings server-side."
    );
  }
  if (toolName === "generate_anchor") requireVisualOutput(task, "anchor");
  if (toolName === "generate_storyboard" || toolName === "generate_keyframe") {
    requireVisualOutput(task, "keyframe");
  }
  if (toolName === "generate_clip") requireVisualOutput(task, "clip");
  if (toolName === "regenerate_image_asset") {
    const assetId = parsed.assetId;
    const asset = typeof assetId === "string"
      ? snapshot.assets.find((candidate) => candidate.id === assetId)
      : undefined;
    if (
      !asset ||
      (asset.kind !== "image" && asset.kind !== "anchor" && asset.kind !== "keyframe")
    ) {
      throw new ToolInputError(
        "regenerate_image_asset requires an authorized image graph asset."
      );
    }
    requireVisualOutput(task, asset.kind);
  }
  if (toolName === "edit_video_asset") {
    if (task.taskKind === "video_edit" && (parsed.provider || parsed.model)) {
      throw new ToolInputError(
        "Creator-direct video edits derive provider settings server-side."
      );
    }
    if (typeof parsed.sourceAssetId !== "string") {
      throw new ToolInputError("edit_video_asset requires sourceAssetId.");
    }
    assertPinnedVideoSource({
      task,
      scope,
      snapshot,
      sourceAssetId: parsed.sourceAssetId,
    });
  }
  if (
    toolName === "generate_anchor" ||
    toolName === "generate_storyboard" ||
    toolName === "generate_keyframe" ||
    toolName === "generate_clip"
  ) {
    const targets = targetedBeatIds(task, snapshot);
    if (!targets) return input.parsedInput;
    if (
      toolName === "generate_anchor" &&
      !targets.beatIds.length &&
      !targets.sceneIds.length
    ) {
      throw new ToolInputError(
        "generate_anchor requires project, scene, or beat scope."
      );
    }
    if (
      (toolName === "generate_storyboard" || toolName === "generate_keyframe") &&
      !targets.beatIds.length
    ) {
      throw new ToolInputError(
        `${toolName} requires a project, storyboard, scene, beat, panel, or beat-bound asset target.`
      );
    }
    if (toolName === "generate_clip" && !targets.beatIds.length) {
      throw new ToolInputError(
        "generate_clip requires a project, storyboard, scene, beat, panel, or beat-bound asset target."
      );
    }
    return {
      ...parsed,
      ...(targets.beatIds.length
        ? toolName === "generate_clip"
          ? { beatIds: targets.beatIds }
          : { targetBeatIds: targets.beatIds }
        : {}),
      ...(targets.sceneIds.length ? { targetSceneIds: targets.sceneIds } : {}),
    };
  }
  return input.parsedInput;
}
