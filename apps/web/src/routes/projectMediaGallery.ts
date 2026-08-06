import type { AssetKind, AssetStatus, V1Asset } from "@popcorn/shared/v1/types";

export type ProjectMediaAsset = Omit<V1Asset, "source"> & {
  source: V1Asset["source"] | { type?: string | null } | string | null;
  visibility?: "public" | "private" | null;
  thumbnailUrl?: string | null;
  remoteUrl?: string | null;
  graphInputs?: Array<{
    assetId: string;
    relation?: string;
    role?: string;
  }>;
  provenance?: {
    prompt?: string;
    instruction?: string;
    editInstruction?: string;
    sourceAssetId?: string;
  };
};

export type GalleryRenderState = "loading" | "error" | "empty" | "ready";

export function projectMediaQueryParams() {
  return { limit: 100 };
}

export function projectMediaQueryKey(projectId: string) {
  return ["projects", projectId, "assets", projectMediaQueryParams()] as const;
}

export function shouldPollProjectMediaAssets(assets: Pick<V1Asset, "status">[]): boolean {
  return assets.some(
    (asset) => asset.status === "pending" || asset.status === "processing",
  );
}

export function galleryRenderState(input: {
  loading: boolean;
  error: unknown;
  assets: readonly ProjectMediaAsset[];
}): GalleryRenderState {
  if (input.loading) return "loading";
  if (input.error) return "error";
  if (input.assets.length === 0) return "empty";
  return "ready";
}

export function assetDisplayTitle(asset: Pick<V1Asset, "filename" | "id"> & { name?: string }) {
  return asset.name?.trim() || asset.filename || asset.id;
}

export function assetPreviewUrl(asset: ProjectMediaAsset): string | undefined {
  return asset.thumbnailUrl ?? asset.remoteUrl ?? asset.url ?? undefined;
}

export function assetSourceLabel(source: ProjectMediaAsset["source"]): string {
  if (
    typeof source === "object" &&
    source?.type === "derived" &&
    "relation" in source &&
    source.relation === "first_frame_of"
  ) {
    return "first frame";
  }
  const raw = typeof source === "object" ? source?.type : source;
  if (!raw) return "asset";
  if (raw === "multipart_upload") return "upload";
  if (raw === "derived") return "derived";
  if (raw === "first_frame_of") return "first frame";
  return raw.replaceAll("_", " ");
}

const PROVENANCE_PREVIEW_MAX = 96;

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function previewText(value: string): string {
  const compact = compactText(value);
  if (compact.length <= PROVENANCE_PREVIEW_MAX) return compact;
  return `${compact.slice(0, PROVENANCE_PREVIEW_MAX - 3)}...`;
}

export function editedAssetLineageLabel(
  asset: Pick<ProjectMediaAsset, "graphInputs" | "provenance">,
  assetById: ReadonlyMap<string, Pick<ProjectMediaAsset, "filename" | "id"> & { name?: string }>,
): string | null {
  const sourceInput = asset.graphInputs?.find(
    (input) => input.relation === "input" && input.role === "edited_from",
  );
  const sourceAssetId = sourceInput?.assetId ?? asset.provenance?.sourceAssetId;
  if (!sourceAssetId) return null;

  const source = assetById.get(sourceAssetId);
  const sourceLabel = source ? assetDisplayTitle(source) : "source";
  const instruction =
    asset.provenance?.instruction ??
    asset.provenance?.editInstruction ??
    asset.provenance?.prompt;
  const instructionLabel = instruction?.trim() ? ` · ${previewText(instruction)}` : "";
  return `Edited from ${sourceLabel}${instructionLabel}`;
}

export function formatDuration(seconds?: number | null): string | null {
  if (!Number.isFinite(seconds ?? NaN)) return null;
  const totalSeconds = Math.max(0, Math.round(seconds ?? 0));
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export function statusLabel(status: AssetStatus): string {
  if (status === "pending") return "Processing";
  return status[0].toUpperCase() + status.slice(1);
}

export function kindLabel(kind: AssetKind): string {
  if (kind === "audio") return "Audio";
  if (kind === "video") return "Video";
  return "Image";
}
