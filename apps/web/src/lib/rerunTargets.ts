import type { RerunTarget } from "@popcorn/shared/rerun-proposal";
import type { BoardRevisionTarget } from "@popcorn/shared/v1/types";

export function boardRevisionTargetToRerunTarget(
  projectId: string,
  target: BoardRevisionTarget
): RerunTarget | null {
  const assetId =
    target.assetId ?? target.clipAssetId ?? target.keyframeAssetId;
  if (assetId) return { kind: "asset", projectId, assetId };
  if (target.panelId) {
    return { kind: "panel", projectId, panelId: target.panelId };
  }
  if (target.beatId) {
    return { kind: "beat", projectId, beatId: target.beatId };
  }
  if (target.sceneId) {
    return { kind: "scene", projectId, sceneId: target.sceneId };
  }
  if (target.storyboardId) {
    return {
      kind: "storyboard",
      projectId,
      storyboardId: target.storyboardId,
    };
  }
  if (
    target.scope === "concept" ||
    target.scope === "brief" ||
    target.scope === "script"
  ) {
    return { kind: "project", projectId };
  }
  return null;
}

export function cutSelectionRerunTarget(projectId: string): RerunTarget {
  return {
    kind: "selection",
    projectId,
    slotOwnerLineageId: null,
    slotRole: "cut",
  };
}

export function resolveRerunTarget(
  projectId: string,
  target: BoardRevisionTarget | null,
  directTarget?: RerunTarget | null
): RerunTarget | null {
  return directTarget ??
    (target ? boardRevisionTargetToRerunTarget(projectId, target) : null);
}
