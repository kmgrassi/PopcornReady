import type { AssetKind } from "./schemas";
import { ApiError } from "./errors";

export interface MediaProbeResult {
  durationSec?: number;
  contentHashBytes?: Buffer;
}

export function probeUploadedMedia(input: {
  bytes: Buffer;
  kind: AssetKind;
  filename: string;
}): MediaProbeResult {
  if (input.bytes.length === 0) {
    throw new ApiError("media_unreadable", "Uploaded media is empty.");
  }
  if (!looksLikeMedia(input.bytes, input.kind, input.filename)) {
    throw new ApiError("media_unreadable", "Uploaded object is not readable media.");
  }
  return { contentHashBytes: input.bytes };
}

function looksLikeMedia(bytes: Buffer, kind: AssetKind, filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (kind === "image") return looksLikeImage(bytes, ext);
  if (kind === "audio") return looksLikeAudio(bytes, ext);
  return looksLikeVideo(bytes, ext);
}

function looksLikeImage(bytes: Buffer, ext: string): boolean {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return true;
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return true;
  }
  if (bytes.subarray(0, 6).toString("ascii") === "GIF87a") return true;
  if (bytes.subarray(0, 6).toString("ascii") === "GIF89a") return true;
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return true;
  }
  return ext === "svg" && bytes.subarray(0, 256).toString("utf8").includes("<svg");
}

function looksLikeAudio(bytes: Buffer, ext: string): boolean {
  if (bytes.subarray(0, 3).toString("ascii") === "ID3") return true;
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return true;
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WAVE") {
    return true;
  }
  if (hasIsoBaseMediaBrand(bytes) && ["m4a", "aac"].includes(ext)) return true;
  return bytes.subarray(0, 4).toString("ascii") === "OggS";
}

function looksLikeVideo(bytes: Buffer, ext: string): boolean {
  if (hasIsoBaseMediaBrand(bytes) && ["mp4", "mov", "m4v"].includes(ext)) return true;
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]) && ["webm", "mkv"].includes(ext)) {
    return true;
  }
  return false;
}

function hasIsoBaseMediaBrand(bytes: Buffer): boolean {
  return bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";
}

function startsWith(bytes: Buffer, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}
