import type {
  BoardRevisionTarget,
  GenerationStageItem,
  GenerationStageType,
} from "@popcorn/shared/v1/types";

export function reviewProposalTarget(input: {
  stageType: GenerationStageType;
  runId?: string;
  items?: GenerationStageItem[];
  storyboardId?: string | null;
}): BoardRevisionTarget | null {
  const assetItems = (input.items ?? []).filter(
    (item): item is GenerationStageItem & { assetId: string } =>
      Boolean(item.assetId)
  );
  const uniqueAssetIds = new Set(assetItems.map((item) => item.assetId));
  if (assetItems.length === 1 && uniqueAssetIds.size === 1) {
    return {
      scope: "asset",
      runId: input.runId,
      assetId: assetItems[0].assetId,
      label: assetItems[0].label,
    };
  }
  if (input.stageType === "storyboard" && input.storyboardId) {
    return {
      scope: "board",
      runId: input.runId,
      storyboardId: input.storyboardId,
      label: "Storyboard",
    };
  }
  if (input.stageType === "brief_intake") {
    return { scope: "concept", runId: input.runId, label: "Concept" };
  }
  if (input.stageType === "creative_plan") {
    return { scope: "brief", runId: input.runId, label: "Brief" };
  }
  return null;
}
