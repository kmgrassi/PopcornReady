import { type LlmUsage } from "@popcorn/llm";
import { type GenerativeAssetKind } from "@popcorn/shared/generative/types";
import { type GraphAssetInput, sha256Hex } from "./asset-graph";
import { type LlmCostScope, withLlmCostRecording } from "./llm-costs";
import { type ParsedRequest } from "./generated-asset-request";
import { resolveAssetMetadata } from "./naming";

export function generatedAssetIdempotentActionId(input: {
  workspaceId: string;
  projectId: string;
  idempotencyKey: string;
}): string {
  const digest = sha256Hex(
    [
      "generated-asset-action.v1",
      input.workspaceId,
      input.projectId,
      "asset_generation",
      input.idempotencyKey,
    ].join(":")
  );
  const variant = ((Number.parseInt(digest[16]!, 16) & 0x3) | 0x8).toString(16);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    `${variant}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

export function pooledImageRevisionWriteContext(input: {
  runId?: string;
  sessionClaimGeneration?: number;
  graphInputs?: GraphAssetInput[];
}): {
  graphInputs?: GraphAssetInput[];
  orchestratorRunId?: string;
  sessionClaimGeneration?: number;
} {
  return {
    ...(input.graphInputs ? { graphInputs: input.graphInputs } : {}),
    ...(input.runId && input.sessionClaimGeneration !== undefined
      ? {
          orchestratorRunId: input.runId,
          sessionClaimGeneration: input.sessionClaimGeneration,
        }
      : {}),
  };
}

export function generatedAssetLlmCostScope(
  projectId: string,
  runId: string | undefined,
  actionId: string
): LlmCostScope {
  return { projectId, ...(runId ? { runId } : {}), actionId };
}

type RecordLlmUsage = (scope: LlmCostScope, usage: LlmUsage) => Promise<void>;

interface ResolveGeneratedAssetMetadataWithCostArgs {
  scope: LlmCostScope;
  input: Parameters<typeof resolveAssetMetadata>[0];
  resolveMetadata?: typeof resolveAssetMetadata;
  recordUsage?: RecordLlmUsage;
}

/** Keeps optional AI display-name generation in the owning asset action's cost scope. */
export async function resolveGeneratedAssetMetadataWithCost(
  args: ResolveGeneratedAssetMetadataWithCostArgs
): Promise<Awaited<ReturnType<typeof resolveAssetMetadata>>> {
  return withLlmCostRecording(
    args.scope,
    () => (args.resolveMetadata ?? resolveAssetMetadata)(args.input),
    args.recordUsage
  );
}

export type ProgressItemKind =
  | "image"
  | "video"
  | "audio"
  | "caption"
  | "timeline"
  | "export";

export interface RunStageItemHandle {
  update(patch: { progressPercent?: number; message?: string }): Promise<void>;
  succeed(patch?: { assetId?: string; message?: string }): Promise<void>;
  fail(error: { code: string; message: string; retryable?: boolean }): Promise<void>;
}

export interface RunStageHandle {
  startItem(input: {
    kind: ProgressItemKind;
    label: string;
    provider?: string;
    prompt?: string;
    promptPreview?: string;
  }): Promise<RunStageItemHandle>;
  attachJob(jobId: string): Promise<void>;
}

export function stageItemKindForAssetKind(kind: GenerativeAssetKind): ProgressItemKind {
  if (kind === "audio") return "audio";
  if (kind === "video") return "video";
  return "image";
}

export function actionToolForParsed(
  parsed: Pick<ParsedRequest, "kind" | "assetRole">
): string {
  if (parsed.kind === "image" && parsed.assetRole === "standalone_image") return "generate_image_asset";
  if (parsed.kind === "video" && parsed.assetRole === "standalone_video") return "generate_video_asset";
  if (parsed.kind === "image" && parsed.assetRole === "poster") return "generate_poster";
  if (parsed.kind === "audio") return "generate_audio";
  if (parsed.kind === "video") return "generate_clip";
  return "generate_keyframe";
}

export function generatedInputAssetIds(
  parsed: Pick<ParsedRequest, "referenceAssetIds" | "anchorIds" | "graphInputs" | "editSourceAssetId" | "sourceAssetId">
): string[] {
  return [
    ...new Set([
      ...parsed.referenceAssetIds,
      ...parsed.anchorIds,
      ...(parsed.graphInputs ?? []).map((input) => input.assetId),
      ...(parsed.editSourceAssetId ? [parsed.editSourceAssetId] : []),
      ...(parsed.sourceAssetId ? [parsed.sourceAssetId] : []),
    ]),
  ];
}

export function buildGenerationActionProposal(args: {
  parsed: ParsedRequest;
  jobId: string;
  estimatedCostUsd: number;
  pinnedFingerprints: Record<string, string>;
}): Record<string, unknown> {
  return {
    summary: `Generate ${args.parsed.kind} asset with ${args.parsed.provider}.`,
    plannedWork: [{
      tool: actionToolForParsed(args.parsed),
      provider: args.parsed.provider,
      kind: args.parsed.kind,
      durationSec: args.parsed.durationSec,
      jobId: args.jobId,
    }],
    pinnedFingerprints: args.pinnedFingerprints,
    estimate: {
      costUsd: args.estimatedCostUsd,
      unit: args.parsed.kind === "image" ? "generation" : `${args.parsed.durationSec}s`,
    },
  };
}
