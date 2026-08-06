import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

import { ApiError } from "./errors";

const execFileAsync = promisify(execFile);

export interface SampledVideoFrame {
  sec: number;
  path: string;
  filename: string;
}

export function videoSampleTimes(
  durationSec: number | undefined,
  defaultSamples: number,
  maxSamples: number
): number[] {
  const sampleCount =
    durationSec && durationSec >= 120
      ? maxSamples
      : Math.min(defaultSamples, maxSamples);
  if (!durationSec || !Number.isFinite(durationSec) || durationSec <= 0) {
    return [0];
  }
  if (sampleCount <= 1) return [Math.max(0, durationSec / 2)];

  const usableEnd = Math.max(0, durationSec - 0.2);
  return Array.from({ length: sampleCount }, (_, index) => {
    const ratio = (index + 1) / (sampleCount + 1);
    return Number((usableEnd * ratio).toFixed(3));
  });
}

export async function extractVideoFramesFromPath(input: {
  sourcePath: string;
  outputDir: string;
  timesSec: number[];
  ffmpegPath?: string;
}): Promise<SampledVideoFrame[]> {
  const frames: SampledVideoFrame[] = [];
  for (const [index, sec] of input.timesSec.entries()) {
    const filename = `sample-${String(index + 1).padStart(2, "0")}.jpg`;
    const outputPath = path.join(input.outputDir, filename);
    try {
      await execFileAsync(input.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg", [
        "-y",
        "-ss",
        String(sec),
        "-i",
        input.sourcePath,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        outputPath,
      ]);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new ApiError(
          "asset_invalid",
          "Video feedback is unavailable because frame sampling is not configured."
        );
      }
      throw new ApiError(
        "asset_invalid",
        error instanceof Error ? error.message : "Video frame sampling failed."
      );
    }
    frames.push({ sec, path: outputPath, filename });
  }
  return frames;
}
