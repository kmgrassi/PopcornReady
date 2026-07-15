import { remoteAssetUrlForDelivery, resolveAssetUrl } from "../../storage/asset-urls";
import type { AssetContext } from "./schemas";
import type { AssetMedia, GraphAssetKind } from "./store-content";

export interface AssetMediaUrls {
  url: string | null;
  thumbnailUrl?: string | null;
  expiresAt: string;
}

export interface AssetMediaUrlRow {
  media: AssetMedia;
  kind: GraphAssetKind;
  status: "ready" | "pending";
  remote_url: string | null;
  storage_key: string | null;
  storage_bucket?: string | null;
  visibility?: "public" | "private" | null;
  context?: {
    context?: AssetContext;
    userContext?: unknown;
    agentContext?: unknown;
    assetKnowledge?: unknown;
    clipUnderstanding?: unknown;
    analysis?: unknown;
  } | null;
}

const MEDIA_URL_EXPIRES_IN_SEC = 60 * 60;

function mediaUrlExpiresAt(now: () => Date = () => new Date()): string {
  return new Date(now().getTime() + MEDIA_URL_EXPIRES_IN_SEC * 1000).toISOString();
}

function mediaKindForThumbnail(
  media: AssetMedia,
  kind: GraphAssetKind
): "image" | "video" | "audio" {
  if (media === "image" || media === "video" || media === "audio") return media;
  if (kind === "audio_track") return "audio";
  if (kind === "anchor" || kind === "keyframe") return "image";
  return "video";
}

export async function assetMediaUrlsForRow(
  row: AssetMediaUrlRow,
  opts: { now?: () => Date } = {}
): Promise<AssetMediaUrls> {
  let url: string | null = null;
  if (row.status === "ready" && row.media !== "data") {
    try {
      url = (await resolveAssetUrl(row, { privateTtlSec: MEDIA_URL_EXPIRES_IN_SEC })) ?? null;
    } catch {
      url = remoteAssetUrlForDelivery(row.remote_url) ?? null;
    }
  }
  const thumbnail = row.context?.context?.renditions?.thumbnail;
  const thumbnailUrl = thumbnail
    ? await resolveRenditionUrl(row, thumbnail.storageKey, thumbnail.storageBucket)
    : mediaKindForThumbnail(row.media, row.kind) === "image"
      ? url
      : null;

  return {
    url,
    thumbnailUrl,
    expiresAt: mediaUrlExpiresAt(opts.now),
  };
}

async function resolveRenditionUrl(
  row: AssetMediaUrlRow,
  storageKey: string,
  storageBucket?: string | null
): Promise<string | null> {
  try {
    return (
      (await resolveAssetUrl(
        {
          remote_url: null,
          storage_key: storageKey,
          storage_bucket: storageBucket ?? row.storage_bucket,
          visibility: row.visibility,
        },
        { privateTtlSec: MEDIA_URL_EXPIRES_IN_SEC }
      )) ?? null
    );
  } catch {
    return null;
  }
}
