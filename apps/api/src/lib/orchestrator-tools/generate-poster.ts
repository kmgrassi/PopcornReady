import { agentApiStore, type AgentApiStore } from "@/lib/agent-api/jobs";
import { getPosterGenerationContext as realGetPosterGenerationContext } from "@/lib/api/v1/store";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";
import { runGeneratePosterJob as realRunGeneratePosterJob } from "./generate-poster-job";

type PosterImageProvider = "openai" | "gemini" | "mock";

export interface GeneratePosterInput {
  provider?: PosterImageProvider;
  force?: boolean;
}

export interface GeneratePosterOutput {
  jobId: string;
}

export interface GeneratePosterDeps {
  getPosterGenerationContext: typeof realGetPosterGenerationContext;
  createJob: AgentApiStore["createOrGetJob"];
  runGeneratePosterJob: typeof realRunGeneratePosterJob;
}

const defaultDeps: GeneratePosterDeps = {
  getPosterGenerationContext: realGetPosterGenerationContext,
  createJob: (input) => agentApiStore.createOrGetJob(input),
  runGeneratePosterJob: realRunGeneratePosterJob,
};

export const generatePosterInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    provider: {
      type: "string",
      enum: ["openai", "gemini", "mock"],
      description: "Optional image provider override. Omit to use OpenAI.",
    },
    force: {
      type: "boolean",
      description: "Regenerate even when a matching ready generated poster already exists.",
    },
  },
  required: [],
} as const;

export const generatePosterOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: { jobId: { type: "string" } },
  required: ["jobId"],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProvider(value: unknown): value is PosterImageProvider {
  return value === "openai" || value === "gemini" || value === "mock";
}

export function parseGeneratePosterInput(input: unknown): GeneratePosterInput {
  if (input === undefined || input === null) return {};
  if (!isRecord(input)) {
    throw new ToolInputError("generate_poster input must be an object.", {
      expected: generatePosterInputSchema,
    });
  }
  const allowed = new Set(["provider", "force"]);
  const extra = Object.keys(input).filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    throw new ToolInputError("generate_poster received unsupported fields.", {
      unsupportedFields: extra,
    });
  }
  if (input.provider !== undefined && !isProvider(input.provider)) {
    throw new ToolInputError("generate_poster provider must be openai, gemini, or mock.", {});
  }
  if (input.force !== undefined && typeof input.force !== "boolean") {
    throw new ToolInputError("generate_poster force must be a boolean.", {});
  }
  return {
    ...(input.provider ? { provider: input.provider } : {}),
    ...(typeof input.force === "boolean" ? { force: input.force } : {}),
  };
}

function briefRequired(): ToolCallResult<GeneratePosterOutput> {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: "generate_poster needs a brief before it can create poster key art.",
      recoverable: true,
      unmetRequirements: [
        {
          requirement: "brief",
          because: "Poster art is composed from the project's active brief.",
          satisfyWith: { tool: "create_or_load_brief", inputHint: {} },
        },
      ],
      suggestedNextTools: [{ tool: "create_or_load_brief", inputHint: {} }],
    },
  };
}

export function createGeneratePosterTool(
  deps: Partial<GeneratePosterDeps> = {}
): ToolDefinition<GeneratePosterInput, GeneratePosterOutput> {
  const resolved = { ...defaultDeps, ...deps };

  return {
    name: "generate_poster",
    description:
      "Generate selected poster key art for the project from the active brief, optional plan, and hero anchor. Runs asynchronously, reuses matching ready generated posters, and never overwrites a manually pinned poster.",
    usage: {
      preconditions: ["An active brief exists (call create_or_load_brief first)."],
      produces: [
        "A ready poster image asset selected as the project poster unless the user manually pinned a poster.",
      ],
      useWhen: [
        "Immediately after the brief is available so the project has visible poster art while downstream media continues.",
        "After the story plan or visual anchors change and poster art should reflect the newer direction.",
      ],
    },
    inputSchema: generatePosterInputSchema,
    outputSchema: generatePosterOutputSchema,
    execution: "async",
    parseInput: parseGeneratePosterInput,
    estimateCost: () => ({
      estimatedCostUsd: 0,
      unit: "image_generation",
      notes: "One 2:3 poster image unless a matching generated poster can be reused.",
    }),
    async execute(input, context) {
      if (!context.projectId) {
        return {
          status: "failed",
          error: {
            kind: "precondition_unmet",
            message: "generate_poster requires a projectId in the execution context.",
            recoverable: false,
          },
        };
      }

      const posterContext = await resolved.getPosterGenerationContext(
        context.auth.workspaceId,
        context.projectId
      );
      if (!posterContext.briefAsset) return briefRequired();

      const { job } = await resolved.createJob({
        type: "asset_generation",
        projectId: context.projectId,
      });

      void resolved.runGeneratePosterJob({
        jobId: job.id,
        workspaceId: context.auth.workspaceId,
        projectId: context.projectId,
        ...(context.orchestratorRunId ? { orchestratorRunId: context.orchestratorRunId } : {}),
        ...(input.provider ? { provider: input.provider } : {}),
        ...(typeof input.force === "boolean" ? { force: input.force } : {}),
      });

      return { status: "accepted", jobId: job.id, resumesWhen: "job_terminal" };
    },
  };
}
