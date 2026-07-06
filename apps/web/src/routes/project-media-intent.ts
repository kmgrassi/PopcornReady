import type { AssetKind, VideoBriefInput } from "../lib/api-client";

export type MediaIntentPresetId = "montage" | "trailer" | "narration";

export interface MediaIntentPreset {
  id: MediaIntentPresetId;
  label: string;
  briefTemplate: string;
  minSelection?: number;
  mediaKinds?: AssetKind[];
}

export const MEDIA_INTENT_PRESETS: MediaIntentPreset[] = [
  {
    id: "montage",
    label: "Make a montage",
    briefTemplate: "Cut these into a montage with a fitting soundtrack.",
    minSelection: 2,
    mediaKinds: ["image", "video"],
  },
  {
    id: "trailer",
    label: "Make a trailer",
    briefTemplate: "Cut a dramatic 30-second trailer from these clips.",
    minSelection: 1,
    mediaKinds: ["video"],
  },
  {
    id: "narration",
    label: "Narrate these",
    briefTemplate:
      "Add warm narration grounded in what happens, and keep the best original audio.",
    minSelection: 1,
    mediaKinds: ["video"],
  },
];

export type SelectionAction =
  | { type: "toggle"; assetId: string }
  | { type: "clear" }
  | { type: "selectAll"; assetIds: string[] };

export function selectionReducer(
  selectedIds: string[],
  action: SelectionAction
): string[] {
  switch (action.type) {
    case "toggle":
      return selectedIds.includes(action.assetId)
        ? selectedIds.filter((id) => id !== action.assetId)
        : [...selectedIds, action.assetId];
    case "clear":
      return [];
    case "selectAll":
      return [...new Set(action.assetIds.filter(Boolean))];
    default:
      return selectedIds;
  }
}

export type MediaIntentAsset = {
  kind: AssetKind;
  status: string;
};

export function selectedPosition(selectedIds: string[], assetId: string): number | null {
  const index = selectedIds.indexOf(assetId);
  return index >= 0 ? index + 1 : null;
}

export function presetConstraintHint(
  preset: MediaIntentPreset | null,
  selectedAssets: MediaIntentAsset[]
): string | null {
  if (!preset) return null;
  if (preset.minSelection && selectedAssets.length < preset.minSelection) {
    return `${preset.label} needs at least ${preset.minSelection} selected ${preset.minSelection === 1 ? "asset" : "assets"}.`;
  }

  if (preset.mediaKinds?.length) {
    const hasAllowedKind = selectedAssets.some((asset) =>
      preset.mediaKinds?.includes(asset.kind)
    );
    if (!hasAllowedKind) {
      return `${preset.label} needs ${preset.mediaKinds.join(" or ")} footage.`;
    }
  }

  return null;
}

export function canCreateMediaIntentRun(input: {
  intentText: string;
  selectedAssets: MediaIntentAsset[];
  preset: MediaIntentPreset | null;
}): boolean {
  if (!input.intentText.trim()) return false;
  if (input.selectedAssets.length === 0) return false;
  if (input.selectedAssets.some((asset) => asset.status !== "ready")) return false;
  return presetConstraintHint(input.preset, input.selectedAssets) === null;
}

export function buildMediaIntentBrief(
  intentText: string,
  orderedAssetIds: string[],
  preset: MediaIntentPreset | null
): VideoBriefInput {
  const narration =
    preset?.id === "narration" ? { narration: { mode: "generate" as const } } : {};
  return {
    goal: intentText.trim(),
    targetLengthSec: preset?.id === "trailer" ? 30 : 45,
    aspectRatio: "9:16",
    constraints: {
      mustUseAssetIds: orderedAssetIds,
    },
    ...narration,
  };
}
