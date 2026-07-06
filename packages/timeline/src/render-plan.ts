import {
  DEFAULT_DURATION_POLICY,
  DURATION_POLICIES,
  DurationPolicy,
  ExportAlignmentResult,
  evaluateExportPolicy,
} from "@popcorn/shared/audio-alignment";
import {
  Clip,
  RenderAudioLayer,
  RenderDurationPolicy,
  RenderPlan,
  Timeline,
  dims,
  timelineDurationSec,
} from "@popcorn/shared/types";

export interface CreateRenderPlanInput {
  timeline: Timeline;
  timelineId?: string;
  audioClips?: Clip[];
  audioMixAssetId?: string;
  audioMixLayers?: RenderAudioLayer[];
  durationPolicy?: DurationPolicy;
  maxDeltaSec?: number;
  quality?: string;
}

export interface CreateRenderPlanResult {
  renderPlan: RenderPlan;
  alignment: ExportAlignmentResult;
}

export function isRenderDurationPolicy(
  value: unknown
): value is RenderDurationPolicy {
  return DURATION_POLICIES.includes(value as DurationPolicy);
}

export function audioClipDurationSec(clip: Clip): number {
  return clip.measuredDurationSec && clip.measuredDurationSec > 0
    ? clip.measuredDurationSec
    : clip.durationSec || 0;
}

export function createRenderPlanFromTimeline(
  input: CreateRenderPlanInput
): CreateRenderPlanResult {
  const fps = input.timeline.fps || 30;
  const { width, height } = dims(input.timeline.aspectRatio);
  const timelineSec = timelineDurationSec(input.timeline);
  const audioClips = input.audioClips ?? [];
  const audioMixLayers = input.audioMixLayers ?? [];
  const audioDurationSec = audioClips.reduce(
    (max, clip) => Math.max(max, audioClipDurationSec(clip)),
    0
  );
  const layeredAudioDurationSec = audioMixLayers.reduce(
    (max, layer) => Math.max(max, layer.outSec),
    0
  );
  const effectiveAudioDurationSec = Math.max(audioDurationSec, layeredAudioDurationSec);
  const durationPolicy = input.durationPolicy ?? DEFAULT_DURATION_POLICY;
  const alignment = evaluateExportPolicy({
    policy: durationPolicy,
    timelineDurationSec: timelineSec,
    audioDurationSec: effectiveAudioDurationSec,
    maxDeltaSec: input.maxDeltaSec,
  });

  return {
    alignment,
    renderPlan: {
      schemaVersion: "render-plan.v1",
      engine: "remotion",
      timelineId: input.timelineId,
      durationPolicy,
      durationSec: alignment.exportDurationSec,
      timelineDurationSec: timelineSec,
      audioDurationSec: effectiveAudioDurationSec,
      ...(input.audioMixAssetId ? { audioMixAssetId: input.audioMixAssetId } : {}),
      audioAssetIds:
        audioMixLayers.length > 0
          ? [...new Set(audioMixLayers.map((layer) => layer.audioAssetId))]
          : audioClips.map((clip) => clip.id),
      ...(audioMixLayers.length > 0 ? { audioMixLayers } : {}),
      output: {
        format: "mp4",
        codec: "h264",
        width,
        height,
        fps,
        quality: input.quality ?? "standard",
      },
    },
  };
}
