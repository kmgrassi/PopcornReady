import type { GenerationStageItem } from "@popcorn/shared/v1/types";

export function canReceiveStageItemFeedback(item: GenerationStageItem): boolean {
  return (
    item.status === "succeeded" &&
    Boolean(item.assetId) &&
    (item.kind === "image" || item.kind === "video")
  );
}
