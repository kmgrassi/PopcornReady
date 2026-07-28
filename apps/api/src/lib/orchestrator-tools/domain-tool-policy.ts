import type { DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";
import type { ProjectGraphSnapshot } from "@/lib/orchestrator-context/graph-snapshot";
import {
  assertScopedPrimitiveInput,
  isAssetInTargetScope,
  type DomainTargetScope,
} from "@/lib/orchestrator-context/target-scope";

import type { ToolName } from "./capability-catalog";
import { ToolInputError } from "./types";
import type { TrustedVisualTargets } from "./visual-targeting";

const PRODUCTION_VISUAL_TOOLS = new Set<ToolName>([
  "generate_anchor",
  "generate_storyboard",
  "generate_keyframe",
  "generate_clip",
  "regenerate_image_asset",
  "edit_video_asset",
]);

export function allowedVisualToolNames(task: DomainTaskV1): readonly ToolName[] {
  if (task.domain !== "visuals") return [];
  if (task.taskKind === "image_create") return ["generate_image_asset"];
  if (task.taskKind === "video_create") return ["generate_video_asset"];
  if (task.taskKind === "video_edit") return ["edit_video_asset"];
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

function targetedVisualTargets(
  task: DomainTaskV1,
  snapshot: ProjectGraphSnapshot
): TrustedVisualTargets | null {
  if (task.targets.some((target) => target.kind === "project")) return null;

  const storyboardIds = new Set<string>();
  const sourceStoryboardIds = new Set<string>();
  const relationalBeatIds = new Set<string>();
  const relationalSceneIds = new Set<string>();
  const planBeatIds = new Set<string>();
  const targetedAssetIds = new Set<string>();
  const targetedLineageIds = new Set<string>();

  for (const target of task.targets) {
    if (target.kind === "storyboard") {
      storyboardIds.add(target.storyboardId);
      sourceStoryboardIds.add(target.storyboardId);
    } else if (target.kind === "scene") {
      relationalSceneIds.add(target.sceneId);
    } else if (target.kind === "beat") {
      relationalBeatIds.add(target.beatId);
    } else if (target.kind === "panel") {
      const panel = snapshot.panels.find((candidate) => candidate.id === target.panelId);
      if (panel) relationalBeatIds.add(panel.beatId);
    } else if (target.kind === "asset") {
      targetedAssetIds.add(target.assetId);
    } else if (target.kind === "lineage") {
      targetedLineageIds.add(target.lineageId);
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
      relationalBeatIds.add(panel.beatId);
    }
  }
  for (const beat of snapshot.beats) {
    if (beat.beatAssetId && targetedAssetIds.has(beat.beatAssetId)) {
      relationalBeatIds.add(beat.id);
    }
  }
  for (const selection of snapshot.selections) {
    if (!targetedAssetIds.has(selection.activeAssetId)) continue;
    const match = /^(?:beat_keyframe|beat_storyboard|beat_clip):(.+)$/.exec(
      selection.slotRole
    );
    if (match?.[1]) planBeatIds.add(match[1]);
  }
  for (const beatId of relationalBeatIds) {
    const beat = snapshot.beats.find((candidate) => candidate.id === beatId);
    if (!beat) continue;
    relationalSceneIds.add(beat.sceneId);
  }
  for (const sceneId of relationalSceneIds) {
    const scene = snapshot.scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) continue;
    sourceStoryboardIds.add(scene.storyboardId);
  }
  return {
    storyboardIds: [...storyboardIds],
    sourceStoryboardIds: [...sourceStoryboardIds],
    sceneIds: [...relationalSceneIds],
    beatIds: [...relationalBeatIds],
    planBeatIds: [...planBeatIds],
  };
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
    const targets = targetedVisualTargets(task, snapshot);
    if (!targets) return input.parsedInput;
    const hasBeatTarget =
      targets.beatIds.length > 0 ||
      targets.planBeatIds.length > 0 ||
      targets.sceneIds.length > 0 ||
      targets.storyboardIds.length > 0;
    if (
      toolName === "generate_anchor" &&
      !hasBeatTarget
    ) {
      throw new ToolInputError(
        "generate_anchor requires project, scene, or beat scope."
      );
    }
    if (
      (toolName === "generate_storyboard" || toolName === "generate_keyframe") &&
      !hasBeatTarget
    ) {
      throw new ToolInputError(
        `${toolName} requires a project, storyboard, scene, beat, panel, or beat-bound asset target.`
      );
    }
    if (toolName === "generate_clip" && !hasBeatTarget) {
      throw new ToolInputError(
        "generate_clip requires a project, storyboard, scene, beat, panel, or beat-bound asset target."
      );
    }
    const prepared =
      toolName === "generate_clip"
        ? Object.fromEntries(
            Object.entries(parsed).filter(
              ([key]) => key !== "beatId" && key !== "beatIds"
            )
          )
        : parsed;
    return { ...prepared, trustedVisualTargets: targets };
  }
  return input.parsedInput;
}
