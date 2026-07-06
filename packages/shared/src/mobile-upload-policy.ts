export type MobileUploadKind = "video" | "image" | "audio";

export type MobileUploadIssueCode =
  | "too_many_files"
  | "unsupported_media_type"
  | "file_too_large"
  | "clip_too_long"
  | "media_unreadable";

export interface MobileUploadCandidate {
  filename: string;
  mimeType?: string;
  sizeBytes: number;
  durationSec?: number;
  kind?: MobileUploadKind;
}

export interface MobileUploadIssue {
  code: MobileUploadIssueCode;
  message: string;
  limit?: number;
  actual?: number;
}

export interface MobileUploadValidation {
  ok: boolean;
  kind: MobileUploadKind | null;
  issue?: MobileUploadIssue;
  requiresTranscode: boolean;
}

export const MOBILE_UPLOAD_MAX_FILES = 10;
export const MOBILE_UPLOAD_MAX_DURATION_SEC = 120;
export const MOBILE_UPLOAD_MAX_VIDEO_BYTES = 200 * 1024 * 1024;
export const MOBILE_UPLOAD_MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MOBILE_UPLOAD_MAX_AUDIO_BYTES = 50 * 1024 * 1024;

const VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/x-m4v",
  "video/hevc",
  "video/heif",
  "video/webm",
]);

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

const AUDIO_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
]);

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm", "hevc", "heif"]);
const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "heic",
  "heif",
]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "aac", "ogg", "webm"]);

const TRANSCODE_EXTENSIONS = new Set(["mov", "hevc", "heic", "heif"]);
const TRANSCODE_MIME_TYPES = new Set([
  "video/quicktime",
  "video/hevc",
  "video/heif",
  "image/heic",
  "image/heif",
]);

function extensionFor(filename: string): string {
  const match = /\.([^.]+)$/.exec(filename.trim().toLowerCase());
  return match?.[1] ?? "";
}

function normalizedMimeType(mimeType?: string): string {
  return mimeType?.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function inferMobileUploadKind(
  filename: string,
  mimeType?: string,
): MobileUploadKind | null {
  const mime = normalizedMimeType(mimeType);
  if (mime.startsWith("video/") || VIDEO_MIME_TYPES.has(mime)) return "video";
  if (mime.startsWith("image/") || IMAGE_MIME_TYPES.has(mime)) return "image";
  if (mime.startsWith("audio/") || AUDIO_MIME_TYPES.has(mime)) return "audio";

  const ext = extensionFor(filename);
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  return null;
}

export function mobileUploadRequiresTranscode(
  filename: string,
  mimeType?: string,
): boolean {
  const ext = extensionFor(filename);
  const mime = normalizedMimeType(mimeType);
  return TRANSCODE_EXTENSIONS.has(ext) || TRANSCODE_MIME_TYPES.has(mime);
}

function maxBytesForKind(kind: MobileUploadKind): number {
  if (kind === "video") return MOBILE_UPLOAD_MAX_VIDEO_BYTES;
  if (kind === "image") return MOBILE_UPLOAD_MAX_IMAGE_BYTES;
  return MOBILE_UPLOAD_MAX_AUDIO_BYTES;
}

function formatLimit(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function validateMobileUploadCandidate(
  candidate: MobileUploadCandidate,
): MobileUploadValidation {
  const kind =
    candidate.kind ?? inferMobileUploadKind(candidate.filename, candidate.mimeType);
  if (!kind) {
    return {
      ok: false,
      kind: null,
      requiresTranscode: false,
      issue: {
        code: "unsupported_media_type",
        message: "Use a video, image, or audio file from your camera roll.",
      },
    };
  }

  const sizeLimit = maxBytesForKind(kind);
  if (candidate.sizeBytes > sizeLimit) {
    return {
      ok: false,
      kind,
      requiresTranscode: mobileUploadRequiresTranscode(
        candidate.filename,
        candidate.mimeType,
      ),
      issue: {
        code: "file_too_large",
        message: `${candidate.filename} is larger than the ${formatLimit(sizeLimit)} upload limit.`,
        limit: sizeLimit,
        actual: candidate.sizeBytes,
      },
    };
  }

  if (
    kind === "video" &&
    typeof candidate.durationSec === "number" &&
    Number.isFinite(candidate.durationSec) &&
    candidate.durationSec > MOBILE_UPLOAD_MAX_DURATION_SEC
  ) {
    return {
      ok: false,
      kind,
      requiresTranscode: mobileUploadRequiresTranscode(
        candidate.filename,
        candidate.mimeType,
      ),
      issue: {
        code: "clip_too_long",
        message: `${candidate.filename} is longer than the ${MOBILE_UPLOAD_MAX_DURATION_SEC}-second clip limit.`,
        limit: MOBILE_UPLOAD_MAX_DURATION_SEC,
        actual: candidate.durationSec,
      },
    };
  }

  return {
    ok: true,
    kind,
    requiresTranscode: mobileUploadRequiresTranscode(
      candidate.filename,
      candidate.mimeType,
    ),
  };
}

export function validateMobileUploadCount(count: number): MobileUploadIssue | null {
  if (count <= MOBILE_UPLOAD_MAX_FILES) return null;
  return {
    code: "too_many_files",
    message: `Choose up to ${MOBILE_UPLOAD_MAX_FILES} clips at a time.`,
    limit: MOBILE_UPLOAD_MAX_FILES,
    actual: count,
  };
}
