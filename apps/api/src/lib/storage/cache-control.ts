import type { AssetVisibility } from "./config";

const IMMUTABLE_ASSET_MAX_AGE_SEC = 365 * 24 * 60 * 60;

export function immutableAssetCacheControl(visibility: AssetVisibility): string {
  const scope = visibility === "public" ? "public" : "private";
  return `${scope}, max-age=${IMMUTABLE_ASSET_MAX_AGE_SEC}, immutable`;
}
