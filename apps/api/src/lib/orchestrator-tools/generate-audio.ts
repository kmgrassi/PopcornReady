import { agentApiStore, type AgentApiStore } from "@/lib/agent-api/jobs";
import {
  getActiveProjectBrief as realGetActiveProjectBrief,
  getActiveProjectPlan as realGetActiveProjectPlan,
} from "@/lib/api/v1/store";
import { toolDefinitionMetadata } from "./capability-catalog";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";
import { runGenerateAudioJob as realRunGenerateAudioJob } from "./generate-audio-job";

type AudioProvider = "elevenlabs" | "mock";

export interface GenerateAudioInput {
  provider?: AudioProvider;
  voiceId?: string;
  feedback?: string;
}

export interface GenerateAudioOutput {
  jobId?: string;
  assetIds?: string[];
}

export interface GenerateAudioDeps {
  getActiveProjectPlan: typeof realGetActiveProjectPlan;
  getActiveProjectBrief: typeof realGetActiveProjectBrief;
  createJob: AgentApiStore["createOrGetJob"];
  runGenerateAudioJob: typeof realRunGenerateAudioJob;
}

const defaultDeps: GenerateAudioDeps = {
  getActiveProjectPlan: realGetActiveProjectPlan,
  getActiveProjectBrief: realGetActiveProjectBrief,
  createJob: (input) => agentApiStore.createOrGetJob(input),
  runGenerateAudioJob: realRunGenerateAudioJob,
};

export const generateAudioInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    provider: {
      type: "string",
      enum: ["elevenlabs", "mock"],
      description: "Optional audio provider override. Omit to use the workspace audio-generation setting.",
    },
    voiceId: {
      type: "string",
      description: "Optional ElevenLabs voice id for generated voiceover.",
    },
    feedback: {
      type: "string",
      description: "Optional note about narration delivery or music direction.",
    },
  },
  required: [],
} as const;

export const generateAudioOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    jobId: { type: "string" },
    assetIds: { type: "array", items: { type: "string" } },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProvider(value: unknown): value is AudioProvider {
  return value === "elevenlabs" || value === "mock";
}

function optionalTrimmedString(
  value: unknown,
  field: string
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ToolInputError(`generate_audio ${field} must be a string.`, {});
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function parseGenerateAudioInput(input: unknown): GenerateAudioInput {
  if (input === undefined || input === null) return {};
  if (!isRecord(input)) {
    throw new ToolInputError("generate_audio input must be an object.", {
      expected: generateAudioInputSchema,
    });
  }
  const allowed = new Set(["provider", "voiceId", "feedback"]);
  const extra = Object.keys(input).filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    throw new ToolInputError("generate_audio received unsupported fields.", {
      unsupportedFields: extra,
    });
  }
  if (input.provider !== undefined && !isProvider(input.provider)) {
    throw new ToolInputError("generate_audio provider must be elevenlabs or mock.", {});
  }
  const voiceId = optionalTrimmedString(input.voiceId, "voiceId");
  const feedback = optionalTrimmedString(input.feedback, "feedback");
  return {
    ...(input.provider ? { provider: input.provider } : {}),
    ...(voiceId ? { voiceId } : {}),
    ...(feedback ? { feedback } : {}),
  };
}

function planRequired(): ToolCallResult<GenerateAudioOutput> {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: "generate_audio needs a shot plan before it can generate beat audio.",
      recoverable: true,
      unmetRequirements: [
        {
          requirement: "plan",
          because:
            "Audio generation needs planned beats for narration text and target durations.",
          satisfyWith: { tool: "plan_shots", inputHint: {} },
        },
      ],
      suggestedNextTools: [{ tool: "plan_shots", inputHint: {} }],
    },
  };
}

export function createGenerateAudioTool(
  deps: Partial<GenerateAudioDeps> = {}
): ToolDefinition<GenerateAudioInput, GenerateAudioOutput> {
  const resolved = { ...defaultDeps, ...deps };

  return {
    ...toolDefinitionMetadata("generate_audio"),
    description:
      "Generate beat voiceover and a soundtrack from the active shot plan and optional brief narration. Requires a plan first, honors already-selected audio slots, and runs asynchronously. Do not include provider unless the user explicitly asks to override workspace settings.",
    usage: {
      preconditions: ["An active shot plan exists (call plan_shots first)."],
      produces: [
        "Generated voiceover audio assets selected per beat, plus a generated soundtrack selected for the project when no user audio is already selected.",
      ],
      useWhen: [
        "The text plan is ready and the visual media chain can run in parallel.",
        "Before assemble_timeline when the final cut should include narration or music.",
      ],
    },
    inputSchema: generateAudioInputSchema,
    outputSchema: generateAudioOutputSchema,
    parseInput: parseGenerateAudioInput,
    estimateCost: () => ({
      estimatedCostUsd: 0,
      unit: "audio_generation",
      notes:
        "One voiceover per planned beat plus one soundtrack; actual cost is recorded by generated-asset jobs.",
    }),
    async execute(input, context) {
      if (!context.projectId) {
        return {
          status: "failed",
          error: {
            kind: "precondition_unmet",
            message: "generate_audio requires a projectId in the execution context.",
            recoverable: false,
          },
        };
      }

      const activePlan = await resolved.getActiveProjectPlan(context.projectId);
      if (!activePlan) return planRequired();

      const activeBrief = await resolved.getActiveProjectBrief(context.projectId);
      const { job } = await resolved.createJob({
        type: "asset_generation",
        projectId: context.projectId,
      });

      void resolved.runGenerateAudioJob({
        jobId: job.id,
        workspaceId: context.auth.workspaceId,
        projectId: context.projectId,
        ...(context.orchestratorRunId ? { orchestratorRunId: context.orchestratorRunId } : {}),
        plan: activePlan.plan,
        planAssetId: activePlan.assetId,
        planContentHash: activePlan.contentHash,
        ...(activeBrief?.brief ? { brief: activeBrief.brief } : {}),
        ...(activeBrief?.assetId ? { briefAssetId: activeBrief.assetId } : {}),
        ...(activeBrief?.contentHash ? { briefContentHash: activeBrief.contentHash } : {}),
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.voiceId ? { voiceId: input.voiceId } : {}),
        ...(input.feedback ? { feedback: input.feedback } : {}),
      });

      return { status: "accepted", jobId: job.id, resumesWhen: "job_terminal" };
    },
  };
}
