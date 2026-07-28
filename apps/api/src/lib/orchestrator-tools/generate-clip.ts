import {
  createDurableOrchestratorJobCreator,
  type OrchestratorJobCreator,
} from "@/lib/orchestrator/job-gateway";
import {
  getActiveProjectScopedAsset as realGetActiveProjectScopedAsset,
  getActiveProjectPlan as realGetActiveProjectPlan,
  getProjectRunGeneratedAsset as realGetProjectRunGeneratedAsset,
  type ActiveProjectPlan,
} from "@/lib/api/v1/store";
import type { ShotPlan } from "@popcorn/shared/types";
import { toolDefinitionMetadata } from "./capability-catalog";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";
import { runGenerateClipJob as realRunGenerateClipJob } from "./generate-clip-job";
import { createLogger } from "@/lib/v1/logger";
import { estimateCostUsd as estimateGenerativeCostUsd } from "@/lib/generative/pricing";

type VideoProvider =
  | "openai"
  | "gemini"
  | "runway"
  | "ltx"
  | "kling"
  | "seedance"
  | "xai"
  | "nvidia_api_catalog"
  | "mock";

export interface GenerateClipInput {
  beatId?: string;
  beatIds?: string[];
  provider?: VideoProvider;
  model?: string;
  durationSec?: number;
  seconds?: number;
  prompt?: string;
  revisionInstruction?: string;
}

export interface GenerateClipOutput {
  jobId?: string;
  assetIds?: string[];
  skippedBeatIds?: string[];
}

export interface GenerateClipJobBeat {
  beatId: string;
  prompt: string;
  durationSec: number;
  keyframeAssetId: string;
  keyframeContentHash?: string;
}

export interface GenerateClipDeps {
  getActiveProjectPlan: typeof realGetActiveProjectPlan;
  getActiveProjectScopedAsset: typeof realGetActiveProjectScopedAsset;
  getProjectRunGeneratedAsset: typeof realGetProjectRunGeneratedAsset;
  createJob: OrchestratorJobCreator["createJob"];
  runGenerateClipJob: typeof realRunGenerateClipJob;
}

const defaultDeps: GenerateClipDeps = {
  getActiveProjectPlan: realGetActiveProjectPlan,
  getActiveProjectScopedAsset: realGetActiveProjectScopedAsset,
  getProjectRunGeneratedAsset: realGetProjectRunGeneratedAsset,
  createJob: createDurableOrchestratorJobCreator().createJob,
  runGenerateClipJob: realRunGenerateClipJob,
};
const logger = createLogger();
const DEFAULT_CLIP_ESTIMATE_PROVIDER: VideoProvider = "openai";
const DEFAULT_CLIP_ESTIMATE_DURATION_SEC = 8;

export const generateClipInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    beatId: {
      type: "string",
      description: "Optional single beat id to generate. Omit to fill every missing beat clip.",
    },
    beatIds: {
      type: "array",
      items: { type: "string" },
      description: "Optional list of beat ids to generate.",
    },
    provider: {
      type: "string",
      enum: [
        "openai",
        "gemini",
        "runway",
        "ltx",
        "kling",
        "seedance",
        "xai",
        "nvidia_api_catalog",
        "mock",
      ],
      description:
        "Optional video provider override. Omit to use the workspace video-generation setting.",
    },
    model: {
      type: "string",
      description:
        "Optional provider model override. Omit to use the workspace video-generation model.",
    },
    durationSec: { type: "number", minimum: 1 },
    seconds: { type: "number", minimum: 1 },
    prompt: { type: "string", description: "Optional prompt override for all requested beats." },
    revisionInstruction: {
      type: "string",
      description: "Optional note appended to each beat prompt.",
    },
  },
  required: [],
} as const;

export const generateClipOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    jobId: { type: "string" },
    assetIds: { type: "array", items: { type: "string" } },
    skippedBeatIds: { type: "array", items: { type: "string" } },
  },
  required: [],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProvider(value: unknown): value is VideoProvider {
  return (
    value === "openai" ||
    value === "gemini" ||
    value === "runway" ||
    value === "ltx" ||
    value === "kling" ||
    value === "seedance" ||
    value === "xai" ||
    value === "nvidia_api_catalog" ||
    value === "mock"
  );
}

function parsePositiveNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ToolInputError(`generate_clip ${field} must be a positive number.`, {});
  }
  return parsed;
}

function parseStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new ToolInputError(`generate_clip ${field} must be an array of strings.`, {});
  }
  const values = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  if (values.length !== value.length) {
    throw new ToolInputError(`generate_clip ${field} must contain only non-empty strings.`, {});
  }
  return [...new Set(values)];
}

function optionalTrimmedString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ToolInputError(`generate_clip ${field} must be a string.`, {});
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function parseGenerateClipInput(input: unknown): GenerateClipInput {
  if (input === undefined || input === null) return {};
  if (!isRecord(input)) {
    throw new ToolInputError("generate_clip input must be an object.", {
      expected: generateClipInputSchema,
    });
  }

  const allowed = new Set([
    "beatId",
    "beatIds",
    "provider",
    "model",
    "durationSec",
    "seconds",
    "prompt",
    "revisionInstruction",
  ]);
  const extra = Object.keys(input).filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    throw new ToolInputError("generate_clip received unsupported fields.", {
      unsupportedFields: extra,
    });
  }
  if (input.provider !== undefined && !isProvider(input.provider)) {
    throw new ToolInputError(
      "generate_clip provider must be openai, gemini, runway, ltx, kling, seedance, xai, nvidia_api_catalog, or mock.",
      {}
    );
  }

  const beatId = optionalTrimmedString(input.beatId, "beatId");
  const beatIds = parseStringArray(input.beatIds, "beatIds");
  if (beatId && beatIds?.length) {
    throw new ToolInputError("generate_clip accepts beatId or beatIds, not both.", {});
  }

  const model = optionalTrimmedString(input.model, "model");
  const durationSec = parsePositiveNumber(input.durationSec, "durationSec");
  const seconds = parsePositiveNumber(input.seconds, "seconds");
  const prompt = optionalTrimmedString(input.prompt, "prompt");
  const revisionInstruction = optionalTrimmedString(
    input.revisionInstruction,
    "revisionInstruction"
  );

  return {
    ...(beatId ? { beatId } : {}),
    ...(beatIds?.length ? { beatIds } : {}),
    ...(isProvider(input.provider) ? { provider: input.provider } : {}),
    ...(model ? { model } : {}),
    ...(durationSec !== undefined ? { durationSec } : {}),
    ...(seconds !== undefined ? { seconds } : {}),
    ...(prompt ? { prompt } : {}),
    ...(revisionInstruction ? { revisionInstruction } : {}),
  };
}

function planBeats(plan: ShotPlan): Array<{ id: string; prompt: string; durationSec: number }> {
  return plan.scenes.flatMap((scene) =>
    scene.beats.flatMap((beat) => {
      if (!beat.id) return [];
      return [
        {
          id: beat.id,
          prompt: [beat.name, beat.intent].filter(Boolean).join(": ") || `Beat ${beat.id}.`,
          durationSec: beat.durationSec || 8,
        },
      ];
    })
  );
}

function selectedBeatIds(input: GenerateClipInput, activePlan: ActiveProjectPlan): string[] {
  const beats = planBeats(activePlan.plan).map((beat) => beat.id);
  if (input.beatId) return [input.beatId];
  if (input.beatIds?.length) return input.beatIds;
  return beats;
}

function missingPlan(): ToolCallResult<GenerateClipOutput> {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: "generate_clip needs an active shot plan before it can choose beats.",
      recoverable: true,
      unmetRequirements: [
        {
          requirement: "plan",
          because: "Clip generation needs planned beat ids, durations, and prompts.",
          satisfyWith: { tool: "plan_shots", inputHint: {} },
        },
      ],
      suggestedNextTools: [{ tool: "plan_shots", inputHint: {} }],
    },
  };
}

function missingKeyframes(beatIds: string[]): ToolCallResult<GenerateClipOutput> {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: "generate_clip needs active beat_keyframe assets before it can generate clips.",
      recoverable: true,
      unmetRequirements: beatIds.map((beatId) => ({
        requirement: "beat_keyframe",
        because: `Beat ${beatId} has no active photoreal first-frame keyframe.`,
        satisfyWith: { tool: "generate_keyframe", inputHint: { beatId } },
      })),
      suggestedNextTools: [{ tool: "generate_keyframe", inputHint: {} }],
    },
  };
}

function unknownBeats(beatIds: string[]): ToolCallResult<GenerateClipOutput> {
  return {
    status: "failed",
    error: {
      kind: "invalid_input",
      message: `Unknown beat id(s): ${beatIds.join(", ")}.`,
      recoverable: true,
      details: { beatIds },
    },
  };
}

export function createGenerateClipTool(
  deps: Partial<GenerateClipDeps> = {}
): ToolDefinition<GenerateClipInput, GenerateClipOutput> {
  const resolved = { ...defaultDeps, ...deps };

  return {
    ...toolDefinitionMetadata("generate_clip"),
    description:
      "Generate motion video clips for planned beats from their active beat_keyframe first frames. Skips beats that already have active beat_clip selections. Runs asynchronously. Do not include provider or model unless the user explicitly asks to override workspace settings.",
    usage: {
      preconditions: [
        "An active shot plan exists (call plan_shots first).",
        "Each requested beat has an active beat_keyframe (call generate_keyframe first).",
      ],
      produces: [
        "Generated beat_clip video assets selected per beat, with graph inputs pointing to their beat_keyframe first frames.",
      ],
      useWhen: [
        "The project has photoreal beat keyframes and needs motion clips for assembly.",
        "After generate_keyframe and before assemble_timeline.",
      ],
    },
    inputSchema: generateClipInputSchema,
    outputSchema: generateClipOutputSchema,
    parseInput: parseGenerateClipInput,
    estimateCost: (input) => ({
      estimatedCostUsd:
        estimateGenerativeCostUsd({
          provider: input.provider ?? DEFAULT_CLIP_ESTIMATE_PROVIDER,
          kind: "video",
          durationSec:
            input.durationSec ?? input.seconds ?? DEFAULT_CLIP_ESTIMATE_DURATION_SEC,
        }) * (input.beatIds?.length ?? 1),
      unit: "video_generation",
      notes: `One video generation per missing beat_clip slot${
        input.provider ? ` using ${input.provider}` : ""
      }.`,
    }),
    async execute(input, context) {
      if (!context.projectId) {
        return {
          status: "failed",
          error: {
            kind: "precondition_unmet",
            message: "generate_clip requires a projectId in the execution context.",
            recoverable: false,
          },
        };
      }

      const activePlan = await resolved.getActiveProjectPlan(context.projectId);
      if (!activePlan) {
        logger.warn("generate_clip.precondition_missing_plan", {
          workspaceId: context.auth.workspaceId,
          projectId: context.projectId,
          runId: context.orchestratorRunId,
        });
        return missingPlan();
      }

      const allBeats = new Map(planBeats(activePlan.plan).map((beat) => [beat.id, beat]));
      const requestedBeatIds = selectedBeatIds(input, activePlan);
      const unknown = requestedBeatIds.filter((beatId) => !allBeats.has(beatId));
      if (unknown.length) return unknownBeats(unknown);

      const skippedBeatIds: string[] = [];
      const jobBeats: GenerateClipJobBeat[] = [];
      const missingKeyframeBeatIds: string[] = [];

      for (const beatId of requestedBeatIds) {
        const selectedClip = await resolved.getActiveProjectScopedAsset({
          workspaceId: context.auth.workspaceId,
          projectId: context.projectId,
          slotRole: `beat_clip:${beatId}`,
          expectedRole: "beat_clip",
        });
        const existingClip =
          selectedClip ??
          (context.orchestratorRunId &&
          context.sessionClaimGeneration !== undefined
            ? await resolved.getProjectRunGeneratedAsset({
                workspaceId: context.auth.workspaceId,
                projectId: context.projectId,
                orchestratorRunId: context.orchestratorRunId,
                role: "beat_clip",
                beatId,
              })
            : null);
        if (existingClip) {
          logger.info("generate_clip.beat_skipped_existing_clip", {
            workspaceId: context.auth.workspaceId,
            projectId: context.projectId,
            runId: context.orchestratorRunId,
            beatId,
            existingClipAssetId: existingClip.id,
          });
          skippedBeatIds.push(beatId);
          continue;
        }

        const selectedKeyframe = await resolved.getActiveProjectScopedAsset({
          workspaceId: context.auth.workspaceId,
          projectId: context.projectId,
          slotRole: `beat_keyframe:${beatId}`,
          expectedRole: "beat_keyframe",
        });
        const keyframe =
          selectedKeyframe ??
          (context.orchestratorRunId &&
          context.sessionClaimGeneration !== undefined
            ? await resolved.getProjectRunGeneratedAsset({
                workspaceId: context.auth.workspaceId,
                projectId: context.projectId,
                orchestratorRunId: context.orchestratorRunId,
                role: "beat_keyframe",
                beatId,
              })
            : null);
        if (!keyframe) {
          logger.warn("generate_clip.beat_missing_keyframe", {
            workspaceId: context.auth.workspaceId,
            projectId: context.projectId,
            runId: context.orchestratorRunId,
            beatId,
            slotRole: `beat_keyframe:${beatId}`,
          });
          missingKeyframeBeatIds.push(beatId);
          continue;
        }

        const beat = allBeats.get(beatId)!;
        const prompt = [input.prompt ?? beat.prompt, input.revisionInstruction]
          .filter(Boolean)
          .join("\n\nRevision instruction: ");
        jobBeats.push({
          beatId,
          prompt,
          durationSec: input.durationSec ?? input.seconds ?? beat.durationSec,
          keyframeAssetId: keyframe.id,
          ...(keyframe.contentHash ? { keyframeContentHash: keyframe.contentHash } : {}),
        });
      }

      if (missingKeyframeBeatIds.length) {
        logger.warn("generate_clip.precondition_missing_keyframes", {
          workspaceId: context.auth.workspaceId,
          projectId: context.projectId,
          runId: context.orchestratorRunId,
          missingKeyframeBeatIds,
          requestedBeatIds,
        });
        return missingKeyframes(missingKeyframeBeatIds);
      }
      if (jobBeats.length === 0) {
        logger.info("generate_clip.noop_all_clips_exist", {
          workspaceId: context.auth.workspaceId,
          projectId: context.projectId,
          runId: context.orchestratorRunId,
          skippedBeatIds,
        });
        return {
          status: "succeeded",
          resourceIds: [],
          output: { assetIds: [], skippedBeatIds },
        };
      }

      const { job, created } = await resolved.createJob({
        workspaceId: context.auth.workspaceId,
        type: "asset_generation",
        projectId: context.projectId,
        sessionClaimGeneration: context.sessionClaimGeneration,
        ...(context.actionId
          ? { actionId: context.actionId, idempotencyKey: `action:${context.actionId}` }
          : {}),
        execution: {
          schemaVersion: "orchestrator_job_execution.v1",
          kind: "generate_clip",
          input: {
            workspaceId: context.auth.workspaceId,
            projectId: context.projectId,
            ...(context.orchestratorRunId ? { orchestratorRunId: context.orchestratorRunId } : {}),
            beats: jobBeats,
            skippedBeatIds,
            ...(input.provider ? { provider: input.provider } : {}),
            ...(input.model ? { model: input.model } : {}),
          },
        },
      });
      logger.info("generate_clip.accepted", {
        workspaceId: context.auth.workspaceId,
        projectId: context.projectId,
        runId: context.orchestratorRunId,
        jobId: job.id,
        beatIds: jobBeats.map((beat) => beat.beatId),
        keyframeAssetIds: jobBeats.map((beat) => beat.keyframeAssetId),
        skippedBeatIds,
      });

      if (created) {
        void resolved.runGenerateClipJob({
          jobId: job.id,
          workspaceId: context.auth.workspaceId,
          projectId: context.projectId,
          ...(context.orchestratorRunId ? { orchestratorRunId: context.orchestratorRunId } : {}),
          ...(context.sessionClaimGeneration !== undefined
            ? { sessionClaimGeneration: context.sessionClaimGeneration }
            : {}),
          beats: jobBeats,
          skippedBeatIds,
          ...(input.provider ? { provider: input.provider } : {}),
          ...(input.model ? { model: input.model } : {}),
        });
      }

      return { status: "accepted", jobId: job.id, resumesWhen: "job_terminal" };
    },
  };
}
