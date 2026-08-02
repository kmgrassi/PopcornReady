import {
  assetUrlRequiresSigning,
  managedAssetObjectExists,
  resolveAssetUrl,
} from "../../storage/asset-urls";
import type { AssetContext } from "./schemas";
import type { AssetMedia, GraphAssetKind } from "./store-content";

export interface AssetMediaUrls {
  url: string | null;
  thumbnailUrl?: string | null;
  expiresAt: string | null;
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

interface AssetMediaUrlOptions {
  now?: () => Date;
  verifyManagedObjects?: boolean;
  objectExists?: typeof managedAssetObjectExists;
  resolveUrl?: typeof resolveAssetUrl;
}

function mediaUrlExpiresAt(now: () => Date = () => new Date()): string {
  return new Date(now().getTime() + MEDIA_URL_EXPIRES_IN_SEC * 1000).toISOString();
}

function mediaKindForThumbnail(
  media: AssetMedia,
  kind: GraphAssetKind
): "image" | "video" | "audio" {
  if (media === "image" || media === "video" || media === "audio") return media;
  if (kind === "audio_track") return "audio";
  if (kind === "image" || kind === "anchor" || kind === "keyframe" || kind === "poster") return "image";
  return "video";
}

export async function assetMediaUrlsForRow(
  row: AssetMediaUrlRow,
  opts: AssetMediaUrlOptions = {}
): Promise<AssetMediaUrls> {
  let url: string | null = null;
  let urlExpiresAt: string | null = null;
  if (row.status === "ready" && row.media !== "data") {
    const exists = await objectExistsForDelivery(row, opts);
    if (exists) {
      url =
        (await (opts.resolveUrl ?? resolveAssetUrl)(row, {
          privateTtlSec: MEDIA_URL_EXPIRES_IN_SEC,
        })) ?? null;
      if (url && assetUrlRequiresSigning(row)) {
        urlExpiresAt = mediaUrlExpiresAt(opts.now);
      }
    }
  }
  const thumbnail = row.context?.context?.renditions?.thumbnail;
  const thumbnailMedia = thumbnail
    ? await resolveRenditionUrl(
        row,
        thumbnail.storageKey,
        thumbnail.storageBucket,
        opts
      )
    : mediaKindForThumbnail(row.media, row.kind) === "image"
      ? { url, expiresAt: urlExpiresAt }
      : { url: null, expiresAt: null };

  return {
    url,
    thumbnailUrl: thumbnailMedia.url,
    expiresAt: earliestExpiry(urlExpiresAt, thumbnailMedia.expiresAt),
  };
}

async function resolveRenditionUrl(
  row: AssetMediaUrlRow,
  storageKey: string,
  storageBucket: string | null | undefined,
  opts: AssetMediaUrlOptions
): Promise<{ url: string | null; expiresAt: string | null }> {
  const rendition = {
    remote_url: null,
    storage_key: storageKey,
    storage_bucket: storageBucket ?? row.storage_bucket,
    visibility: row.visibility,
  };
  const exists = await objectExistsForDelivery(rendition, opts);
  if (!exists) return { url: null, expiresAt: null };
  const url =
    (await (opts.resolveUrl ?? resolveAssetUrl)(rendition, {
      privateTtlSec: MEDIA_URL_EXPIRES_IN_SEC,
    })) ?? null;
  return {
    url,
    expiresAt:
      url && assetUrlRequiresSigning(rendition)
        ? mediaUrlExpiresAt(opts.now)
        : null,
  };
}

async function objectExistsForDelivery(
  asset: Parameters<typeof managedAssetObjectExists>[0],
  opts: AssetMediaUrlOptions
): Promise<boolean> {
  if (!opts.verifyManagedObjects) return true;
  return (opts.objectExists ?? managedAssetObjectExists)(asset);
}

function earliestExpiry(...values: Array<string | null>): string | null {
  const timestamps = values
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  if (timestamps.length === 0) return null;
  return new Date(Math.min(...timestamps)).toISOString();
}
