import type { GenerationStageItem } from "@popcorn/shared/v1/types";

export function latestReadyRunAsset(
  items: readonly GenerationStageItem[],
): GenerationStageItem | null {
  return (
    items
      .filter(
        (item) =>
          item.status === "succeeded" &&
          Boolean(item.assetId) &&
          (item.kind === "image" || item.kind === "video" || item.kind === "audio"),
      )
      .slice()
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          right.itemId.localeCompare(left.itemId),
      )[0] ?? null
  );
}

export function readyAssetViewLabel(
  item: Pick<GenerationStageItem, "kind">,
): string {
  return `View ${item.kind} asset`;
}

export function readyAssetStatus(
  item: Pick<GenerationStageItem, "kind">,
): string {
  return `${item.kind[0]?.toUpperCase()}${item.kind.slice(1)} asset ready to view.`;
}
