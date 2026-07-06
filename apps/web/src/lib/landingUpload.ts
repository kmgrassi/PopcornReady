import type { AssetKind, V1Asset } from "@popcorn/shared/v1/types";
import { v1Api, type RegisterProjectUploadInput } from "./api-client";
import type { SelectedFootage } from "./upload";

export const LANDING_FOOTAGE_ACCEPT = "video/*,image/*";
export const LANDING_MAX_FILES = 10;
// Current landing transport posts base64 JSON through Express' 25 MB body cap.
// Keep raw files below the expanded payload limit until signed-storage upload
// endpoints are available on this branch.
export const LANDING_MAX_FILE_SIZE_BYTES = 16 * 1024 * 1024;
export const LANDING_MAX_DURATION_SEC = 120;

export type LandingUploadStatus =
  | "queued"
  | "uploading"
  | "processing"
  | "ready"
  | "failed";

export interface LandingUploadItem {
  id: string;
  file: File;
  name: string;
  sizeBytes: number;
  durationSec: number;
  status: LandingUploadStatus;
  progress: number;
  assetId?: string;
  error?: string;
}

export interface LandingUploadPreflightResult {
  accepted: SelectedFootage[];
  errors: string[];
}

export function newLandingUploadId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function formatUploadSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  }
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function landingAssetKindForFile(file: File): AssetKind | null {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";

  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  if (["mp4", "mov", "m4v", "webm"].includes(ext)) return "video";
  if (["png", "jpg", "jpeg", "webp", "gif", "heic", "heif"].includes(ext)) {
    return "image";
  }
  return null;
}

export function preflightLandingFootage(
  selected: SelectedFootage[],
  existingCount = 0,
): LandingUploadPreflightResult {
  const accepted: SelectedFootage[] = [];
  const errors: string[] = [];
  const remainingSlots = Math.max(0, LANDING_MAX_FILES - existingCount);

  for (const footage of selected) {
    if (accepted.length >= remainingSlots) {
      errors.push(`Only ${LANDING_MAX_FILES} clips can be added from the landing page.`);
      break;
    }

    const kind = landingAssetKindForFile(footage.file);
    if (kind !== "video" && kind !== "image") {
      errors.push(`${footage.name} is not a supported video or image file.`);
      continue;
    }

    if (footage.sizeBytes > LANDING_MAX_FILE_SIZE_BYTES) {
      errors.push(`${footage.name} is larger than ${formatUploadSize(LANDING_MAX_FILE_SIZE_BYTES)}.`);
      continue;
    }

    if (kind === "video" && footage.durationSec > LANDING_MAX_DURATION_SEC) {
      errors.push(`${footage.name} is longer than ${Math.round(LANDING_MAX_DURATION_SEC / 60)} minutes.`);
      continue;
    }

    accepted.push(footage);
  }

  return { accepted, errors };
}

function fileToBase64WithProgress(
  file: File,
  onProgress: (progress: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.max(2, Math.min(78, (event.loaded / event.total) * 78)));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const [, dataBase64 = ""] = result.split(",", 2);
      if (!dataBase64) {
        reject(new Error("Could not read uploaded file bytes."));
        return;
      }
      onProgress(82);
      resolve(dataBase64);
    };
    reader.readAsDataURL(file);
  });
}

export async function registerLandingUpload(
  projectId: string,
  item: LandingUploadItem,
  onProgress: (progress: number) => void,
): Promise<V1Asset> {
  return registerProjectUploadFile(projectId, item, onProgress, {
    description: `Selected from the landing page: ${item.name}`,
    intendedUse: ["primary_footage"],
  });
}

export async function registerProjectUploadFile(
  projectId: string,
  item: {
    file: File;
    name: string;
    durationSec: number;
    kind?: AssetKind | "audio";
  },
  onProgress: (progress: number) => void,
  userContext: NonNullable<RegisterProjectUploadInput["userContext"]>,
): Promise<V1Asset> {
  const kind = item.kind ?? landingAssetKindForFile(item.file);
  if (kind !== "video" && kind !== "image" && kind !== "audio") {
    throw new Error(`${item.name} is not a supported video or image file.`);
  }

  const dataBase64 = await fileToBase64WithProgress(item.file, onProgress);
  onProgress(88);
  const { asset } = await v1Api.registerProjectUpload(projectId, {
    source: {
      type: "multipart_upload",
      dataBase64,
      mimeType: item.file.type || undefined,
    },
    kind,
    filename: item.name,
    durationSec: item.durationSec,
    userContext,
  });
  onProgress(100);
  return asset;
}
