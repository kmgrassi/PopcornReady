import type { V1Asset } from "@/lib/api/v1/store";
import type { ShotPlan } from "@popcorn/shared/types";
import type { ProjectStoryboard } from "@popcorn/shared/v1/types";

export interface StoryboardHandoffIssue {
  code:
    | "plan_mismatch"
    | "missing_beat_id"
    | "duplicate_beat_id"
    | "missing_scene"
    | "missing_beat"
    | "missing_selected_panel"
    | "panel_not_ready"
    | "asset_missing"
    | "asset_not_ready"
    | "asset_wrong_kind"
    | "asset_wrong_role"
    | "asset_wrong_beat"
    | "asset_wrong_plan";
  beatId?: string;
  sceneIndex?: number;
  beatIndex?: number;
  assetId?: string;
}

export type StoryboardAssetLoader = (assetId: string) => Promise<V1Asset | null>;

export function plannedBeatIds(plan: ShotPlan): string[] {
  return plan.scenes.flatMap((scene) =>
    scene.beats.map((beat) => beat.id?.trim() ?? "")
  );
}

export function persistedBeatIdSetIssues(
  plan: ShotPlan,
  persistedBeatIds: string[]
): StoryboardHandoffIssue[] {
  const expected = plannedBeatIds(plan);
  const issues: StoryboardHandoffIssue[] = [];
  const expectedCounts = new Map<string, number>();
  const persistedCounts = new Map<string, number>();

  for (const beatId of expected) {
    if (!beatId) {
      issues.push({ code: "missing_beat_id" });
      continue;
    }
    expectedCounts.set(beatId, (expectedCounts.get(beatId) ?? 0) + 1);
  }
  for (const beatId of persistedBeatIds) {
    persistedCounts.set(beatId, (persistedCounts.get(beatId) ?? 0) + 1);
  }

  for (const [beatId, count] of expectedCounts) {
    if (count > 1) issues.push({ code: "duplicate_beat_id", beatId });
    if (persistedCounts.get(beatId) !== 1) {
      issues.push({ code: "missing_selected_panel", beatId });
    }
  }
  for (const [beatId, count] of persistedCounts) {
    if (count > 1 || !expectedCounts.has(beatId)) {
      issues.push({ code: "duplicate_beat_id", beatId });
    }
  }
  return issues;
}

export async function storyboardHandoffIssues(input: {
  plan: ShotPlan;
  planAssetId: string;
  storyboard: ProjectStoryboard;
  loadAsset: StoryboardAssetLoader;
}): Promise<StoryboardHandoffIssue[]> {
  const issues: StoryboardHandoffIssue[] = [];
  if (input.storyboard.planAssetId !== input.planAssetId) {
    issues.push({ code: "plan_mismatch" });
    return issues;
  }

  const seenBeatIds = new Set<string>();
  for (let sceneIndex = 0; sceneIndex < input.plan.scenes.length; sceneIndex += 1) {
    const scene = input.plan.scenes[sceneIndex];
    const storyboardScene = input.storyboard.scenes.find(
      (candidate) => candidate.sceneIndex === sceneIndex
    );
    if (!storyboardScene) {
      issues.push({ code: "missing_scene", sceneIndex });
      continue;
    }

    for (let beatIndex = 0; beatIndex < scene.beats.length; beatIndex += 1) {
      const beatId = scene.beats[beatIndex].id?.trim();
      if (!beatId) {
        issues.push({ code: "missing_beat_id", sceneIndex, beatIndex });
        continue;
      }
      if (seenBeatIds.has(beatId)) {
        issues.push({ code: "duplicate_beat_id", beatId, sceneIndex, beatIndex });
        continue;
      }
      seenBeatIds.add(beatId);

      const storyboardBeat = storyboardScene.beats.find(
        (candidate) => candidate.beatIndex === beatIndex
      );
      if (!storyboardBeat) {
        issues.push({ code: "missing_beat", beatId, sceneIndex, beatIndex });
        continue;
      }
      const selectedPanel = storyboardBeat.panels.find(
        (panel) => panel.isSelected && panel.imageAssetId
      );
      if (!selectedPanel?.imageAssetId) {
        issues.push({ code: "missing_selected_panel", beatId, sceneIndex, beatIndex });
        continue;
      }
      if (selectedPanel.status !== "ready" && selectedPanel.status !== "approved") {
        issues.push({
          code: "panel_not_ready",
          beatId,
          sceneIndex,
          beatIndex,
          assetId: selectedPanel.imageAssetId,
        });
        continue;
      }

      const asset = await input.loadAsset(selectedPanel.imageAssetId);
      if (!asset) {
        issues.push({
          code: "asset_missing",
          beatId,
          sceneIndex,
          beatIndex,
          assetId: selectedPanel.imageAssetId,
        });
        continue;
      }
      if (asset.status !== "ready") {
        issues.push({ code: "asset_not_ready", beatId, assetId: asset.id });
      }
      if (asset.kind !== "image") {
        issues.push({ code: "asset_wrong_kind", beatId, assetId: asset.id });
      }
      if (asset.role !== "beat_storyboard") {
        issues.push({ code: "asset_wrong_role", beatId, assetId: asset.id });
      }
      if (asset.provenance?.beatId !== beatId) {
        issues.push({ code: "asset_wrong_beat", beatId, assetId: asset.id });
      }
      if (
        !asset.graphInputs?.some(
          (edge) =>
            edge.assetId === input.planAssetId &&
            edge.relation === "input" &&
            edge.role === "plan"
        )
      ) {
        issues.push({ code: "asset_wrong_plan", beatId, assetId: asset.id });
      }
    }
  }
  return issues;
}

export async function firstUsableStoryboardForPlan(input: {
  plan: ShotPlan;
  planAssetId: string;
  storyboards: ProjectStoryboard[];
  loadAsset: StoryboardAssetLoader;
}): Promise<ProjectStoryboard | null> {
  for (const storyboard of input.storyboards) {
    const issues = await storyboardHandoffIssues({
      plan: input.plan,
      planAssetId: input.planAssetId,
      storyboard,
      loadAsset: input.loadAsset,
    });
    if (issues.length === 0) return storyboard;
  }
  return null;
}
