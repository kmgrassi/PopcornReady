import type {
  ActiveProjectPlan,
  VisualAnchorPlan,
} from "@/lib/api/v1/store";
import type { ShotPlan } from "@popcorn/shared/types";
import type { ProjectStoryboard } from "@popcorn/shared/v1/types";

import { ToolInputError } from "./types";

/**
 * Trusted target identities retain their namespace until the active plan is
 * loaded. Relational story ids must never be compared directly with ShotPlan
 * ids; selected slot suffixes are already ShotPlan beat ids.
 */
export interface TrustedVisualTargets {
  /** Storyboard ids explicitly targeted as a whole. */
  storyboardIds: string[];
  /** Exact storyboard identity that owns relational scene/beat ids. */
  sourceStoryboardIds: string[];
  sceneIds: string[];
  beatIds: string[];
  planBeatIds: string[];
}

export interface ResolvedVisualTargets {
  planBeatIds: string[];
  planSceneIds: string[];
  sourceStoryboard: ProjectStoryboard | null;
}

export type StoryboardLoader = (
  storyboardId: string
) => Promise<ProjectStoryboard | null>;

function planIdentity(plan: ShotPlan): {
  beatById: Map<string, { sceneIndex: number; beatIndex: number }>;
  sceneById: Map<string, number>;
} {
  const beatById = new Map<string, { sceneIndex: number; beatIndex: number }>();
  const sceneById = new Map<string, number>();
  for (let sceneIndex = 0; sceneIndex < plan.scenes.length; sceneIndex += 1) {
    const scene = plan.scenes[sceneIndex];
    const sceneId = scene.id?.trim();
    if (sceneId) {
      if (sceneById.has(sceneId)) {
        throw new ToolInputError(`The active plan contains duplicate scene id ${sceneId}.`);
      }
      sceneById.set(sceneId, sceneIndex);
    }
    for (let beatIndex = 0; beatIndex < scene.beats.length; beatIndex += 1) {
      const beatId = scene.beats[beatIndex].id?.trim();
      if (!beatId) {
        throw new ToolInputError(
          `The active plan beat at scene ${sceneIndex}, beat ${beatIndex} has no stable id.`
        );
      }
      if (beatById.has(beatId)) {
        throw new ToolInputError(`The active plan contains duplicate beat id ${beatId}.`);
      }
      beatById.set(beatId, { sceneIndex, beatIndex });
    }
  }
  return { beatById, sceneById };
}

export async function resolveVisualTargets(input: {
  activePlan: ActiveProjectPlan;
  targets?: TrustedVisualTargets;
  loadStoryboard: StoryboardLoader;
}): Promise<ResolvedVisualTargets | null> {
  if (!input.targets) return null;
  const { beatById } = planIdentity(input.activePlan.plan);
  const storyboardIds = new Set(input.targets.storyboardIds);
  const sourceIds = new Set<string>(input.targets.sourceStoryboardIds);
  const loadedCandidates: ProjectStoryboard[] = [];

  // Scene/beat ids are globally opaque. Locate them only inside the explicitly
  // trusted storyboard identities supplied by the fresh graph snapshot.
  for (const storyboardId of sourceIds) {
    const storyboard = await input.loadStoryboard(storyboardId);
    if (!storyboard || storyboard.planAssetId !== input.activePlan.assetId) {
      throw new ToolInputError(
        "The trusted relational target is not bound to the active shot plan."
      );
    }
    loadedCandidates.push(storyboard);
  }
  if (loadedCandidates.length > 1) {
    throw new ToolInputError(
      "Scoped Visuals work cannot combine relational targets from multiple storyboard attempts."
    );
  }
  const sourceStoryboard = loadedCandidates[0] ?? null;
  if (
    (input.targets.sceneIds.length > 0 || input.targets.beatIds.length > 0) &&
    !sourceStoryboard
  ) {
    throw new ToolInputError("Relational Visuals targets require one exact storyboard.");
  }

  const resolvedBeatIds = new Set<string>();
  const resolvedSceneIds = new Set<string>();
  for (const beatId of input.targets.planBeatIds) {
    const position = beatById.get(beatId);
    if (!position) throw new ToolInputError(`Unknown active-plan beat id: ${beatId}.`);
    resolvedBeatIds.add(beatId);
    const sceneId = input.activePlan.plan.scenes[position.sceneIndex].id?.trim();
    if (sceneId) resolvedSceneIds.add(sceneId);
  }

  if (sourceStoryboard) {
    const targetedScenes = new Set(input.targets.sceneIds);
    const targetedBeats = new Set(input.targets.beatIds);
    const wholeStoryboard = storyboardIds.has(sourceStoryboard.id);
    const foundScenes = new Set<string>();
    const foundBeats = new Set<string>();

    for (const storyboardScene of sourceStoryboard.scenes) {
      const planScene = input.activePlan.plan.scenes[storyboardScene.sceneIndex];
      if (!planScene) {
        throw new ToolInputError("The targeted storyboard no longer matches the active plan.");
      }
      const sceneTargeted = wholeStoryboard || targetedScenes.has(storyboardScene.id);
      if (targetedScenes.has(storyboardScene.id)) foundScenes.add(storyboardScene.id);
      if (sceneTargeted) {
        const planSceneId = planScene.id?.trim();
        if (!planSceneId) {
          throw new ToolInputError("The targeted plan scene has no stable id.");
        }
        resolvedSceneIds.add(planSceneId);
      }
      for (const storyboardBeat of storyboardScene.beats) {
        const beatTargeted = sceneTargeted || targetedBeats.has(storyboardBeat.id);
        if (targetedBeats.has(storyboardBeat.id)) foundBeats.add(storyboardBeat.id);
        if (!beatTargeted) continue;
        const planBeatId = planScene.beats[storyboardBeat.beatIndex]?.id?.trim();
        if (!planBeatId || !beatById.has(planBeatId)) {
          throw new ToolInputError(
            "The targeted storyboard beat no longer maps to a stable active-plan beat."
          );
        }
        resolvedBeatIds.add(planBeatId);
      }
    }
    if (
      foundScenes.size !== targetedScenes.size ||
      foundBeats.size !== targetedBeats.size
    ) {
      throw new ToolInputError(
        "One or more trusted relational targets are absent from their storyboard."
      );
    }
  }

  if (resolvedBeatIds.size === 0 && resolvedSceneIds.size === 0) {
    throw new ToolInputError("No active-plan beats intersect the trusted Visuals targets.");
  }
  return {
    planBeatIds: [...resolvedBeatIds],
    planSceneIds: [...resolvedSceneIds],
    sourceStoryboard,
  };
}

export function shotPlanForTargetBeats(
  plan: ShotPlan,
  targetBeatIds?: readonly string[]
): ShotPlan {
  if (targetBeatIds === undefined) return plan;
  const allowed = new Set(targetBeatIds);
  return {
    ...plan,
    scenes: plan.scenes
      .map((scene) => ({
        ...scene,
        beats: scene.beats.filter((beat) => {
          const beatId = beat.id?.trim();
          return Boolean(beatId && allowed.has(beatId));
        }),
      }))
      .filter((scene) => scene.beats.length > 0),
  };
}

export function storyboardForTargetPlanBeats(
  plan: ShotPlan,
  storyboard: ProjectStoryboard,
  targetBeatIds?: readonly string[]
): ProjectStoryboard {
  if (targetBeatIds === undefined) return storyboard;
  const allowed = new Set(targetBeatIds);
  return {
    ...storyboard,
    scenes: storyboard.scenes
      .map((storyboardScene) => {
        const planScene = plan.scenes[storyboardScene.sceneIndex];
        return {
          ...storyboardScene,
          beats: storyboardScene.beats.filter((storyboardBeat) => {
            const planBeatId =
              planScene?.beats[storyboardBeat.beatIndex]?.id?.trim();
            return Boolean(planBeatId && allowed.has(planBeatId));
          }),
        };
      })
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
