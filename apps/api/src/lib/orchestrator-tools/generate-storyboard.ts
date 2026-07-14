import { agentApiStore, type AgentApiStore } from "@/lib/agent-api/jobs";
import { getActiveProjectPlan as realGetActiveProjectPlan } from "@/lib/api/v1/store";
import { toolDefinitionMetadata } from "./capability-catalog";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";
import { runStoryboardJob as realRunStoryboardJob } from "./storyboard-job";

// generate_storyboard reads the project's persisted plan (the stage→stage handoff
// through the asset graph) and generates one cheap sketch tile per beat. It is the
// first ASYNC tool: it enqueues a job, kicks off the background work, and returns
// `accepted` so the orchestrator parks the run and resumes when the job completes.
export interface GenerateStoryboardInput {
  /** Optional instruction to revise an existing storyboard. */
  feedback?: string;
}

export interface GenerateStoryboardOutput {
  jobId: string;
}

export interface GenerateStoryboardDeps {
  getActiveProjectPlan: typeof realGetActiveProjectPlan;
  createJob: AgentApiStore["createOrGetJob"];
  runStoryboardJob: typeof realRunStoryboardJob;
}

const defaultDeps: GenerateStoryboardDeps = {
  getActiveProjectPlan: realGetActiveProjectPlan,
  createJob: (input) => agentApiStore.createOrGetJob(input),
  runStoryboardJob: realRunStoryboardJob,
};

export const generateStoryboardInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    feedback: { type: "string", description: "Optional revision instruction." },
  },
} as const;

export const generateStoryboardOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: { jobId: { type: "string" } },
  required: ["jobId"],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseGenerateStoryboardInput(input: unknown): GenerateStoryboardInput {
  if (input === undefined || input === null) return {};
  if (!isRecord(input)) {
    throw new ToolInputError("generate_storyboard input must be an object.", {
      expected: generateStoryboardInputSchema,
    });
  }
  const feedback = input.feedback;
  if (feedback !== undefined && typeof feedback !== "string") {
    throw new ToolInputError("generate_storyboard feedback must be a string.", {});
  }
  return feedback && feedback.trim() ? { feedback: feedback.trim() } : {};
}

function planRequired(): ToolCallResult<GenerateStoryboardOutput> {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: "generate_storyboard needs a shot plan before it can sketch the storyboard.",
      recoverable: true,
      unmetRequirements: [
        {
          requirement: "plan",
          because: "Storyboard tiles are generated one per planned beat.",
          satisfyWith: { tool: "plan_shots", inputHint: {} },
        },
      ],
      suggestedNextTools: [{ tool: "plan_shots", inputHint: {} }],
    },
  };
}

export function createGenerateStoryboardTool(
  deps: Partial<GenerateStoryboardDeps> = {}
): ToolDefinition<GenerateStoryboardInput, GenerateStoryboardOutput> {
  const resolved = { ...defaultDeps, ...deps };

  return {
    ...toolDefinitionMetadata("generate_storyboard"),
    description:
      "Generate cheap sketch beat_storyboard tiles — one previsualization image per planned beat — and persist them as the project's storyboard. Requires a plan first. Runs asynchronously. Do not use this to satisfy a missing beat_keyframe; beat_keyframe first-frame assets come from generate_keyframe.",
    usage: {
      preconditions: ["An active shot plan exists (call plan_shots first)."],
      produces: [
        "Cheap sketch beat_storyboard tiles — one per planned beat — persisted as the project's storyboard. Runs asynchronously (parks the run until the job completes).",
        "Selected beat_storyboard tiles that generate_keyframe can use as composition references.",
      ],
      useWhen: [
        "The plan (and any visual anchors) is ready and you need a low-cost previsualization before committing to expensive media generation.",
        "generate_keyframe failed because selected beat_storyboard tiles are missing.",
        "Do not use when generate_clip failed because beat_keyframe assets are missing; call generate_keyframe instead.",
      ],
    },
    inputSchema: generateStoryboardInputSchema,
    outputSchema: generateStoryboardOutputSchema,
    parseInput: parseGenerateStoryboardInput,
    estimateCost: () => ({
      estimatedCostUsd: 0,
      unit: "image_generation",
      notes: "One cheap sketch tile per beat; cost scales with beat count and provider.",
    }),
    async execute(_input, context) {
      if (!context.projectId) {
        return {
          status: "failed",
          error: {
            kind: "precondition_unmet",
            message: "generate_storyboard requires a projectId in the execution context.",
            recoverable: false,
          },
        };
      }

      const active = await resolved.getActiveProjectPlan(context.projectId);
      if (!active) {
        return planRequired();
      }

      const { job } = await resolved.createJob({
        type: "asset_generation",
        projectId: context.projectId,
      });

      // Fire-and-forget: the worker writes the tiles + storyboard, marks the job
      // terminal, and resumes the parked run on completion.
      void resolved.runStoryboardJob({
        jobId: job.id,
        workspaceId: context.auth.workspaceId,
        projectId: context.projectId,
        ...(context.orchestratorRunId ? { orchestratorRunId: context.orchestratorRunId } : {}),
        plan: active.plan,
        planAssetId: active.assetId,
        planContentHash: active.contentHash,
      });

      return { status: "accepted", jobId: job.id, resumesWhen: "job_terminal" };
    },
  };
}
