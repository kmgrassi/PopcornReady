import type { RerunTarget } from "@popcorn/shared/rerun-proposal";
import type { BoardRevisionTarget } from "@popcorn/shared/v1/types";

function targetIdentity(target: RerunTarget) {
  switch (target.kind) {
    case "project": return `project:${target.projectId}`;
    case "storyboard": return `storyboard:${target.storyboardId}`;
    case "scene": return `scene:${target.sceneId}`;
    case "beat": return `beat:${target.beatId}`;
    case "panel": return `panel:${target.panelId}`;
    case "asset": return `asset:${target.assetId}`;
    case "lineage": return `lineage:${target.lineageId}`;
    case "timeline_item": return `timeline:${target.timelineItemId}`;
    case "export": return `export:${target.exportId}`;
    case "selection":
      return `selection:${target.slotOwnerLineageId ?? "project"}:${target.slotRole}`;
    case "transcript_segment": return `transcript:${target.transcriptSegmentId}`;
  }
}

function reviewSurfaceIdentity(target: BoardRevisionTarget | null) {
  if (!target) return "direct";
  return [
    target.scope,
    target.runId ?? "no-run",
    target.stageId ?? "no-stage",
    target.itemId ?? "no-item",
    target.fieldId ?? "no-field",
  ].join(":");
}

export function rerunProposalStorageKey(
  projectId: string,
  target: RerunTarget,
  reviewTarget: BoardRevisionTarget | null
) {
  return `popcorn:rerun-proposal:${projectId}:${reviewSurfaceIdentity(reviewTarget)}:${targetIdentity(target)}`;
}
