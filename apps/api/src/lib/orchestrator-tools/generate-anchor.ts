import {
  createDurableOrchestratorJobCreator,
  type OrchestratorJobCreator,
} from "@/lib/orchestrator/job-gateway";
import {
  getActiveProjectVisualAnchorPlan as realGetActiveProjectVisualAnchorPlan,
} from "@/lib/api/v1/store";
import { toolDefinitionMetadata } from "./capability-catalog";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";
import { runGenerateAnchorJob as realRunGenerateAnchorJob } from "./generate-anchor-job";

type AnchorImageProvider = "openai" | "gemini" | "mock";

export interface GenerateAnchorInput {
  provider?: AnchorImageProvider;
  feedback?: string;
}

export interface GenerateAnchorOutput {
  jobId: string;
}

export interface GenerateAnchorDeps {
  getActiveProjectVisualAnchorPlan: typeof realGetActiveProjectVisualAnchorPlan;
  createJob: OrchestratorJobCreator["createJob"];
  runGenerateAnchorJob: typeof realRunGenerateAnchorJob;
}

const defaultDeps: GenerateAnchorDeps = {
  getActiveProjectVisualAnchorPlan: realGetActiveProjectVisualAnchorPlan,
  createJob: createDurableOrchestratorJobCreator().createJob,
  runGenerateAnchorJob: realRunGenerateAnchorJob,
};

export const generateAnchorInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    provider: {
      type: "string",
      enum: ["openai", "gemini", "mock"],
      description:
        "Optional image provider override. Omit to use the workspace image-generation setting; minor likenesses still route to Gemini.",
    },
    feedback: {
      type: "string",
      description: "Optional note from the model about the intended anchor style.",
    },
  },
  required: [],
} as const;

export const generateAnchorOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: { jobId: { type: "string" } },
  required: ["jobId"],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProvider(value: unknown): value is AnchorImageProvider {
  return value === "openai" || value === "gemini" || value === "mock";
}

export function parseGenerateAnchorInput(input: unknown): GenerateAnchorInput {
  if (input === undefined || input === null) return {};
  if (!isRecord(input)) {
    throw new ToolInputError("generate_anchor input must be an object.", {
      expected: generateAnchorInputSchema,
    });
  }
  const allowed = new Set(["provider", "feedback"]);
  const extra = Object.keys(input).filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    throw new ToolInputError("generate_anchor received unsupported fields.", {
      unsupportedFields: extra,
    });
  }
  if (input.provider !== undefined && !isProvider(input.provider)) {
    throw new ToolInputError("generate_anchor provider must be openai, gemini, or mock.", {});
  }
  if (input.feedback !== undefined && typeof input.feedback !== "string") {
    throw new ToolInputError("generate_anchor feedback must be a string.", {});
  }
  const feedback = input.feedback?.trim();
  return {
    ...(input.provider ? { provider: input.provider } : {}),
    ...(feedback ? { feedback } : {}),
  };
}

function visualAnchorPlanRequired(): ToolCallResult<GenerateAnchorOutput> {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: "generate_anchor needs a visual anchor plan before it can generate anchors.",
      recoverable: true,
      unmetRequirements: [
        {
          requirement: "visual_anchor_plan",
          because:
            "Anchor generation needs the typed character/location/style anchors derived from the shot plan.",
          satisfyWith: { tool: "plan_visual_anchors", inputHint: {} },
        },
      ],
      suggestedNextTools: [{ tool: "plan_visual_anchors", inputHint: {} }],
    },
  };
}

export function createGenerateAnchorTool(
  deps: Partial<GenerateAnchorDeps> = {}
): ToolDefinition<GenerateAnchorInput, GenerateAnchorOutput> {
  const resolved = { ...defaultDeps, ...deps };

  return {
    ...toolDefinitionMetadata("generate_anchor"),
    description:
      "Generate reusable character and scene anchor images from the active visual-anchor plan. Requires plan_visual_anchors first. Runs asynchronously. Do not include provider unless the user explicitly asks to override workspace settings.",
    usage: {
      preconditions: [
        "An active visual-anchor plan exists (call plan_visual_anchors first).",
      ],
      produces: [
        "Generated character_anchor and scene_anchor image assets selected for each planned visual anchor.",
      ],
      useWhen: [
        "The plan has recurring characters, locations, or style references that later keyframes should reuse for continuity.",
        "Before generate_keyframe when keyframes need stable character or scene references.",
      ],
    },
    inputSchema: generateAnchorInputSchema,
    outputSchema: generateAnchorOutputSchema,
    parseInput: parseGenerateAnchorInput,
    estimateCost: () => ({
      estimatedCostUsd: 0,
      unit: "image_generation",
      notes: "One image per planned anchor; actual cost is recorded by the generated-asset jobs.",
    }),
    async execute(input, context) {
      if (!context.projectId) {
        return {
          status: "failed",
          error: {
            kind: "precondition_unmet",
            message: "generate_anchor requires a projectId in the execution context.",
            recoverable: false,
          },
        };
      }

      const active = await resolved.getActiveProjectVisualAnchorPlan(context.projectId);
      if (!active) return visualAnchorPlanRequired();

      const { job, created } = await resolved.createJob({
        workspaceId: context.auth.workspaceId,
        type: "asset_generation",
        projectId: context.projectId,
        ...(context.actionId
          ? { actionId: context.actionId, idempotencyKey: `action:${context.actionId}` }
          : {}),
        execution: {
          schemaVersion: "orchestrator_job_execution.v1",
          kind: "generate_anchor",
          input: {
            workspaceId: context.auth.workspaceId,
            projectId: context.projectId,
            ...(context.orchestratorRunId ? { orchestratorRunId: context.orchestratorRunId } : {}),
            visualAnchorPlan: active.visualAnchorPlan,
            visualAnchorPlanAssetId: active.assetId,
            visualAnchorPlanContentHash: active.contentHash,
            ...(input.provider ? { provider: input.provider } : {}),
          },
        },
      });

      if (created) {
        void resolved.runGenerateAnchorJob({
          jobId: job.id,
          workspaceId: context.auth.workspaceId,
          projectId: context.projectId,
          ...(context.orchestratorRunId ? { orchestratorRunId: context.orchestratorRunId } : {}),
          visualAnchorPlan: active.visualAnchorPlan,
          visualAnchorPlanAssetId: active.assetId,
          visualAnchorPlanContentHash: active.contentHash,
          ...(input.provider ? { provider: input.provider } : {}),
        });
      }

      return { status: "accepted", jobId: job.id, resumesWhen: "job_terminal" };
    },
  };
}
