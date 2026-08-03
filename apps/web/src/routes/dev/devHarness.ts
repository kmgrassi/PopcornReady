import type { AssetKind, AssetStatus } from "@popcorn/shared/v1/types";

const viteEnv = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env;

export const isDevHarnessEnabled = viteEnv?.DEV ?? false;

export const devHarnessRoutes = {
  creationProgress: "/dev/creation-progress",
  designSystem: "/dev/design-system",
  generationCards: "/dev/generation-cards",
  landingUpload: "/dev/landing-upload",
  mediaGallery: "/dev/media-gallery",
  videoEdit: "/dev/video-edit",
} as const;

export type LandingUploadHarnessStatus =
  | "queued"
  | "uploading"
  | "processing"
  | "ready"
  | "failed";

export interface LandingUploadHarnessItem {
  id: string;
  name: string;
  kind: "video" | "image";
  sizeLabel: string;
  durationLabel?: string;
  status: LandingUploadHarnessStatus;
  progress: number;
  error?: string;
}

export interface GalleryHarnessAsset {
  id: string;
  kind: AssetKind;
  status: AssetStatus;
  title: string;
  source: "upload" | "generated" | "share target";
  durationLabel?: string;
  selectedOrder?: number;
  thumbTone: "coral" | "blue" | "gold" | "green" | "violet" | "neutral";
}

export interface IntentPreset {
  id: string;
  label: string;
  active?: boolean;
}

export const landingUploadHarnessItems: LandingUploadHarnessItem[] = [
  {
    id: "clip-queued",
    name: "sidewalk-hook.mov",
    kind: "video",
    sizeLabel: "18.4 MB",
    durationLabel: "0:14",
    status: "queued",
    progress: 0,
  },
  {
    id: "clip-uploading",
    name: "midnight-cookie-closeup.mp4",
    kind: "video",
    sizeLabel: "22.9 MB",
    durationLabel: "0:21",
    status: "uploading",
    progress: 58,
  },
  {
    id: "still-processing",
    name: "menu-board.jpg",
    kind: "image",
    sizeLabel: "3.6 MB",
    status: "processing",
    progress: 86,
  },
  {
    id: "clip-ready",
    name: "first-bite-reaction.mov",
    kind: "video",
    sizeLabel: "16.1 MB",
    durationLabel: "0:12",
    status: "ready",
    progress: 100,
  },
  {
    id: "clip-failed",
    name: "counter-pan.heic",
    kind: "image",
    sizeLabel: "7.2 MB",
    status: "failed",
    progress: 34,
    error: "Upload stalled after the connection dropped.",
  },
];

export const mediaGalleryHarnessAssets: GalleryHarnessAsset[] = [
  {
    id: "asset-selected-1",
    kind: "video",
    status: "ready",
    title: "Opening street pull-in",
    source: "upload",
    durationLabel: "0:14",
    selectedOrder: 1,
    thumbTone: "coral",
  },
  {
    id: "asset-processing",
    kind: "video",
    status: "processing",
    title: "Oven tray detail",
    source: "generated",
    durationLabel: "0:06",
    thumbTone: "gold",
  },
  {
    id: "asset-selected-2",
    kind: "image",
    status: "ready",
    title: "Menu board still",
    source: "share target",
    selectedOrder: 2,
    thumbTone: "blue",
  },
  {
    id: "asset-pending",
    kind: "audio",
    status: "pending",
    title: "Room tone from phone",
    source: "upload",
    durationLabel: "0:38",
    thumbTone: "green",
  },
  {
    id: "asset-failed",
    kind: "video",
    status: "failed",
    title: "Counter pan",
    source: "upload",
    durationLabel: "0:09",
    thumbTone: "neutral",
  },
  {
    id: "asset-ready",
    kind: "image",
    status: "ready",
    title: "Cookie box hero",
    source: "generated",
    thumbTone: "violet",
  },
];

export const mediaGalleryIntentPresets: IntentPreset[] = [
  { id: "primary-footage", label: "Primary footage", active: true },
  { id: "b-roll", label: "B-roll" },
  { id: "hero-shot", label: "Hero shot" },
  { id: "audio-bed", label: "Audio bed" },
];

export function harnessRoutesForBuild(isDev: boolean): string[] {
  return isDev ? Object.values(devHarnessRoutes) : [];
}

export function landingUploadStatusCounts(
  items: readonly LandingUploadHarnessItem[],
): Record<LandingUploadHarnessStatus, number> {
  return items.reduce<Record<LandingUploadHarnessStatus, number>>(
    (counts, item) => ({ ...counts, [item.status]: counts[item.status] + 1 }),
    { queued: 0, uploading: 0, processing: 0, ready: 0, failed: 0 },
  );
}

export function selectedGalleryAssets(
  assets: readonly GalleryHarnessAsset[],
): GalleryHarnessAsset[] {
  return assets
    .filter((asset) => Number.isInteger(asset.selectedOrder))
    .sort((a, b) => (a.selectedOrder ?? 0) - (b.selectedOrder ?? 0));
}
