import type { ShotPlan } from "@popcorn/shared/types";
import type { ProjectStoryboard } from "@popcorn/shared/v1/types";
import type { VisualAnchorPlan } from "@/lib/api/v1/store";

export function shotPlanForTargetBeats(
  plan: ShotPlan,
  targetBeatIds?: readonly string[]
): ShotPlan {
  if (!targetBeatIds?.length) return plan;
  const allowed = new Set(targetBeatIds);
  return {
    ...plan,
    scenes: plan.scenes
      .map((scene) => ({
        ...scene,
        beats: scene.beats.filter((beat) => allowed.has(beat.id ?? beat.name)),
      }))
      .filter((scene) => scene.beats.length > 0),
  };
}

export function storyboardForTargetBeats(
  storyboard: ProjectStoryboard,
  targetBeatIds?: readonly string[]
): ProjectStoryboard {
  if (!targetBeatIds?.length) return storyboard;
  const allowed = new Set(targetBeatIds);
  return {
    ...storyboard,
    scenes: storyboard.scenes
      .map((scene) => ({
        ...scene,
        beats: scene.beats.filter((beat) => allowed.has(beat.id)),
      }))
      .filter((scene) => scene.beats.length > 0),
  };
}

export function anchorPlanForTargets(
  plan: VisualAnchorPlan,
  targetBeatIds?: readonly string[],
  targetSceneIds?: readonly string[]
): VisualAnchorPlan {
  if (!targetBeatIds?.length && !targetSceneIds?.length) return plan;
  const beats = new Set(targetBeatIds ?? []);
  const scenes = new Set(targetSceneIds ?? []);
  return {
    ...plan,
    anchors: plan.anchors.filter(
      (anchor) =>
        anchor.sourceBeatIds.some((id) => beats.has(id)) ||
        anchor.sourceSceneIds.some((id) => scenes.has(id))
    ),
  };
}
