import {
  createDurableOrchestratorJobCreator,
  type OrchestratorJobCreator,
} from "@/lib/orchestrator/job-gateway";
import {
  getActiveProjectPlan as realGetActiveProjectPlan,
  getAsset as realGetAsset,
  getProjectStoryboardsForPlan as realGetProjectStoryboardsForPlan,
} from "@/lib/api/v1/store";
import { ApiError } from "@/lib/api/v1/errors";
import { toolDefinitionMetadata } from "./capability-catalog";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";
import { runGenerateKeyframeJob as realRunGenerateKeyframeJob } from "./generate-keyframe-job";
import { createLogger } from "@/lib/v1/logger";
import {
  firstUsableStoryboardForPlan,
  storyboardHandoffIssues,
} from "./storyboard-keyframe-handoff";

type KeyframeImageProvider = "openai" | "ideogram" | "gemini" | "xai" | "mock";

export interface GenerateKeyframeInput {
  provider?: KeyframeImageProvider;
  feedback?: string;
}

export interface GenerateKeyframeOutput {
  jobId: string;
}

export interface GenerateKeyframeDeps {
  getActiveProjectPlan: typeof realGetActiveProjectPlan;
  getProjectStoryboardsForPlan: typeof realGetProjectStoryboardsForPlan;
  getAsset: typeof realGetAsset;
  createJob: OrchestratorJobCreator["createJob"];
  runGenerateKeyframeJob: typeof realRunGenerateKeyframeJob;
}

const defaultDeps: GenerateKeyframeDeps = {
  getActiveProjectPlan: realGetActiveProjectPlan,
  getProjectStoryboardsForPlan: realGetProjectStoryboardsForPlan,
  getAsset: realGetAsset,
  createJob: createDurableOrchestratorJobCreator().createJob,
  runGenerateKeyframeJob: realRunGenerateKeyframeJob,
};
const logger = createLogger();

export const generateKeyframeInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    provider: {
      type: "string",
      enum: ["openai", "ideogram", "gemini", "xai", "mock"],
      description:
        "Optional image provider override. Omit to use the workspace image-generation setting; minor likenesses still route to Gemini.",
    },
    feedback: {
      type: "string",
      description: "Optional note about the desired keyframe revision.",
    },
  },
  required: [],
} as const;

export const generateKeyframeOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: { jobId: { type: "string" } },
  required: ["jobId"],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProvider(value: unknown): value is KeyframeImageProvider {
  return (
    value === "openai" ||
    value === "ideogram" ||
    value === "gemini" ||
    value === "xai" ||
    value === "mock"
  );
}

export function parseGenerateKeyframeInput(input: unknown): GenerateKeyframeInput {
  if (input === undefined || input === null) return {};
  if (!isRecord(input)) {
    throw new ToolInputError("generate_keyframe input must be an object.", {
      expected: generateKeyframeInputSchema,
    });
  }
  const allowed = new Set(["provider", "feedback"]);
  const extra = Object.keys(input).filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    throw new ToolInputError("generate_keyframe received unsupported fields.", {
      unsupportedFields: extra,
    });
  }
  if (input.provider !== undefined && !isProvider(input.provider)) {
    throw new ToolInputError(
      "generate_keyframe provider must be openai, ideogram, gemini, xai, or mock.",
      {}
    );
  }
  if (input.feedback !== undefined && typeof input.feedback !== "string") {
    throw new ToolInputError("generate_keyframe feedback must be a string.", {});
  }
  const feedback = input.feedback?.trim();
  return {
    ...(input.provider ? { provider: input.provider } : {}),
    ...(feedback ? { feedback } : {}),
  };
}

function planRequired(): ToolCallResult<GenerateKeyframeOutput> {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: "generate_keyframe needs a shot plan before it can generate beat keyframes.",
      recoverable: true,
      unmetRequirements: [
        {
          requirement: "plan",
          because: "Keyframes are generated one per planned beat.",
          satisfyWith: { tool: "plan_shots", inputHint: {} },
        },
      ],
      suggestedNextTools: [{ tool: "plan_shots", inputHint: {} }],
    },
  };
}

function storyboardRequired(): ToolCallResult<GenerateKeyframeOutput> {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: "generate_keyframe needs storyboard tiles before photoreal keyframes.",
      recoverable: true,
      unmetRequirements: [
        {
          requirement: "beat_storyboard",
          because:
            "Keyframes use selected storyboard tiles as structural composition references.",
          satisfyWith: { tool: "generate_storyboard", inputHint: {} },
        },
      ],
      suggestedNextTools: [{ tool: "generate_storyboard", inputHint: {} }],
    },
  };
}

export function createGenerateKeyframeTool(
  deps: Partial<GenerateKeyframeDeps> = {}
): ToolDefinition<GenerateKeyframeInput, GenerateKeyframeOutput> {
  const resolved = { ...defaultDeps, ...deps };

  return {
    ...toolDefinitionMetadata("generate_keyframe"),
    description:
      "Generate photoreal beat_keyframe first-frame images for planned beats. Requires plan_shots and generate_storyboard first. Runs asynchronously and skips beats with active keyframes. This is the recovery tool when generate_clip says beat_keyframe assets are missing. Do not include provider unless the user explicitly asks to override workspace settings.",
    usage: {
      preconditions: [
        "An active shot plan exists (call plan_shots first).",
        "A storyboard with selected beat_storyboard tiles exists (call generate_storyboard first).",
      ],
      produces: [
        "Generated photoreal beat_keyframe image assets selected per beat, with graph inputs back to the plan, storyboard tile, and any active anchors.",
        "Active beat_keyframe:<beat id> selections that generate_clip requires before it can create beat_clip videos.",
      ],
      useWhen: [
        "After storyboard and anchors are ready and the project needs photoreal first frames for clips.",
        "Before generate_clip, because clips require beat_keyframe first frames.",
        "After generate_clip failed with requirement beat_keyframe or suggested generate_keyframe.",
        "Do not confuse this with generate_storyboard: storyboard creates sketch beat_storyboard references, keyframe creates photoreal beat_keyframe first frames.",
      ],
    },
    inputSchema: generateKeyframeInputSchema,
    outputSchema: generateKeyframeOutputSchema,
    parseInput: parseGenerateKeyframeInput,
    estimateCost: () => ({
      estimatedCostUsd: 0,
      unit: "image_generation",
      notes: "One image per beat without an active beat_keyframe selection.",
    }),
    async execute(input, context) {
      if (!context.projectId) {
        return {
          status: "failed",
          error: {
            kind: "precondition_unmet",
            message: "generate_keyframe requires a projectId in the execution context.",
            recoverable: false,
          },
        };
      }

      const active = await resolved.getActiveProjectPlan(context.projectId);
      if (!active) {
        logger.warn("generate_keyframe.precondition_missing_plan", {
          workspaceId: context.auth.workspaceId,
          projectId: context.projectId,
          runId: context.orchestratorRunId,
        });
        return planRequired();
      }

      const storyboards = await resolved.getProjectStoryboardsForPlan(
        context.auth.workspaceId,
        context.projectId,
        active.assetId
      );
      const loadStoryboardAsset = async (assetId: string) => {
        try {
          return await resolved.getAsset(
            context.auth.workspaceId,
            context.projectId!,
            assetId
          );
        } catch (error) {
          if (error instanceof ApiError && error.code === "not_found") return null;
          throw error;
        }
      };
      const storyboard = await firstUsableStoryboardForPlan({
        plan: active.plan,
        planAssetId: active.assetId,
        storyboards,
        loadAsset: loadStoryboardAsset,
      });
      const newestIssues = storyboards[0]
        ? await storyboardHandoffIssues({
            plan: active.plan,
            planAssetId: active.assetId,
            storyboard: storyboards[0],
            loadAsset: loadStoryboardAsset,
          })
        : [];
      if (!storyboard) {
        logger.warn("generate_keyframe.precondition_missing_storyboard", {
          workspaceId: context.auth.workspaceId,
          projectId: context.projectId,
          runId: context.orchestratorRunId,
          planAssetId: active.assetId,
          storyboardCandidateCount: storyboards.length,
          newestStoryboardId: storyboards[0]?.id,
          handoffIssueCodes: newestIssues.map((issue) => issue.code),
        });
        return storyboardRequired();
      }

      const { job } = await resolved.createJob({
        workspaceId: context.auth.workspaceId,
        type: "asset_generation",
        projectId: context.projectId,
        execution: {
          schemaVersion: "orchestrator_job_execution.v1",
          kind: "generate_keyframe",
          input: {
            workspaceId: context.auth.workspaceId,
            projectId: context.projectId,
            ...(context.orchestratorRunId ? { orchestratorRunId: context.orchestratorRunId } : {}),
            plan: active.plan,
            planAssetId: active.assetId,
            planContentHash: active.contentHash,
            storyboard,
            ...(input.provider ? { provider: input.provider } : {}),
          },
        },
      });
      logger.info("generate_keyframe.accepted", {
        workspaceId: context.auth.workspaceId,
        projectId: context.projectId,
        runId: context.orchestratorRunId,
        jobId: job.id,
        planAssetId: active.assetId,
        storyboardId: storyboard.id,
        sceneCount: storyboard.scenes.length,
        beatCount: storyboard.scenes.reduce((count, scene) => count + scene.beats.length, 0),
        panelCount: storyboard.scenes.reduce(
          (count, scene) =>
            count + scene.beats.reduce((beatCount, beat) => beatCount + beat.panels.length, 0),
          0
        ),
      });

      void resolved.runGenerateKeyframeJob({
        jobId: job.id,
        workspaceId: context.auth.workspaceId,
        projectId: context.projectId,
        ...(context.orchestratorRunId ? { orchestratorRunId: context.orchestratorRunId } : {}),
        plan: active.plan,
        planAssetId: active.assetId,
        planContentHash: active.contentHash,
        storyboard,
        ...(input.provider ? { provider: input.provider } : {}),
      });

      return { status: "accepted", jobId: job.id, resumesWhen: "job_terminal" };
    },
  };
}
