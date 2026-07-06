import type { AssetKind, AssetStatus, V1Asset } from "@popcorn/shared/v1/types";

export type ProjectMediaAsset = V1Asset & {
  thumbnailUrl?: string | null;
  remoteUrl?: string | null;
};

export type GalleryRenderState = "loading" | "error" | "empty" | "ready";

export function projectMediaQueryParams() {
  return { limit: 100 };
}

export function projectMediaQueryKey(projectId: string) {
  return ["projects", projectId, "assets", projectMediaQueryParams()] as const;
}

export function shouldPollProjectMediaAssets(assets: Pick<V1Asset, "status">[]): boolean {
  return assets.some((asset) => asset.status === "processing");
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
