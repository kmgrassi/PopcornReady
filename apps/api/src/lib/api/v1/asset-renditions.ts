import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ObjectStore } from "@/lib/storage/object-store";
import { createObjectStore } from "@/lib/storage/object-store";
import type { AssetVisibility } from "@/lib/storage/config";
import type { AssetKind, AssetRendition } from "./schemas";

const execFileAsync = promisify(execFile);
const THUMBNAIL_CONTENT_TYPE = "image/webp";
const THUMBNAIL_FILENAME = "thumbnail.webp";
const THUMBNAIL_MAX_WIDTH = 480;

export function assetThumbnailStorageKey(input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
}): string {
  return [
    input.workspaceId,
    input.projectId,
    input.assetId,
    "renditions",
    THUMBNAIL_FILENAME,
  ].join("/");
}

export async function createThumbnailRendition(input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
  kind: AssetKind;
  filename: string;
  bytes: Buffer;
  visibility: AssetVisibility;
  store?: ObjectStore;
  now?: () => Date;
}): Promise<AssetRendition | null> {
  if (input.kind === "audio") return null;

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "popcornready-rendition-"));
  const inputPath = path.join(tempDir, path.basename(input.filename) || "asset.bin");
  const outputPath = path.join(tempDir, THUMBNAIL_FILENAME);

  try {
    await fs.writeFile(inputPath, input.bytes);
    await runFfmpeg([
      "-y",
      ...(input.kind === "video" ? ["-ss", "0.1"] : []),
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-vf",
      `scale='min(${THUMBNAIL_MAX_WIDTH},iw)':-2`,
      outputPath,
    ]);

    const thumbnailBytes = await fs.readFile(outputPath);
    const key = assetThumbnailStorageKey(input);
    const stored = await (input.store ?? createObjectStore()).putObject({
      key,
      body: thumbnailBytes,
      visibility: input.visibility,
      contentType: THUMBNAIL_CONTENT_TYPE,
    });

    return {
      schemaVersion: "assetRendition.v1",
      kind: "thumbnail",
      storageKey: stored.key,
      storageBucket: stored.bucket,
      contentType: THUMBNAIL_CONTENT_TYPE,
      generatedAt: (input.now ?? (() => new Date()))().toISOString(),
    };
  } catch {
    return null;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runFfmpeg(args: string[]): Promise<void> {
  const ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg";
  await execFileAsync(ffmpegPath, args);
}
