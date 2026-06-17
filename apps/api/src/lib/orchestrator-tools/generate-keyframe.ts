import { agentApiStore, type AgentApiStore } from "@/lib/agent-api/jobs";
import {
  getActiveProjectPlan as realGetActiveProjectPlan,
  getProjectStoryboard as realGetProjectStoryboard,
} from "@/lib/api/v1/store";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";
import { runGenerateKeyframeJob as realRunGenerateKeyframeJob } from "./generate-keyframe-job";

type KeyframeImageProvider = "openai" | "gemini" | "mock";

export interface GenerateKeyframeInput {
  provider?: KeyframeImageProvider;
  feedback?: string;
}

export interface GenerateKeyframeOutput {
  jobId: string;
}

export interface GenerateKeyframeDeps {
  getActiveProjectPlan: typeof realGetActiveProjectPlan;
  getProjectStoryboard: typeof realGetProjectStoryboard;
  createJob: AgentApiStore["createOrGetJob"];
  runGenerateKeyframeJob: typeof realRunGenerateKeyframeJob;
}

const defaultDeps: GenerateKeyframeDeps = {
  getActiveProjectPlan: realGetActiveProjectPlan,
  getProjectStoryboard: realGetProjectStoryboard,
  createJob: (input) => agentApiStore.createOrGetJob(input),
  runGenerateKeyframeJob: realRunGenerateKeyframeJob,
};

export const generateKeyframeInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    provider: {
      type: "string",
      enum: ["openai", "gemini", "mock"],
      description:
        "Optional image provider override. Omit to use OpenAI, or Gemini when a beat/anchor appears to depict a minor.",
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
  return value === "openai" || value === "gemini" || value === "mock";
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
      "generate_keyframe provider must be openai, gemini, or mock.",
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
    name: "generate_keyframe",
    description:
      "Generate photoreal beat_keyframe images for planned beats. Requires plan_shots and generate_storyboard first. Runs asynchronously and skips beats with active keyframes.",
    usage: {
      preconditions: [
        "An active shot plan exists (call plan_shots first).",
        "A storyboard with selected beat_storyboard tiles exists (call generate_storyboard first).",
      ],
      produces: [
        "Generated beat_keyframe image assets selected per beat, with graph inputs back to the plan, storyboard tile, and any active anchors.",
      ],
      useWhen: [
        "After storyboard and anchors are ready and the project needs photoreal first frames for clips.",
        "Before generate_clip, because clips require beat_keyframe first frames.",
      ],
    },
    inputSchema: generateKeyframeInputSchema,
    outputSchema: generateKeyframeOutputSchema,
    execution: "async",
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
      if (!active) return planRequired();

      const storyboard = await resolved.getProjectStoryboard(
        context.auth.workspaceId,
        context.projectId
      );
      if (!storyboard || storyboard.planAssetId !== active.assetId) {
        return storyboardRequired();
      }

      const { job } = await resolved.createJob({
        type: "asset_generation",
        projectId: context.projectId,
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
