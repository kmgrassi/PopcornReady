import { createReachedApprovalGate as realCreateReachedApprovalGate } from "@/lib/api/v1/orchestrator-store";
import type { ToolCallResult, ToolDefinition, ToolName } from "./types";
import { ToolInputError } from "./types";

type ReviewableApprovalStep = Exclude<ToolName, "request_approval">;

export interface RequestApprovalInput {
  step: ReviewableApprovalStep;
  previewArtifactIds: string[];
  note?: string;
}

export interface RequestApprovalOutput {
  gateId: string;
  step: ReviewableApprovalStep;
  previewArtifactIds: string[];
}

export interface RequestApprovalDeps {
  createReachedApprovalGate: typeof realCreateReachedApprovalGate;
}

const defaultDeps: RequestApprovalDeps = {
  createReachedApprovalGate: realCreateReachedApprovalGate,
};

const REVIEWABLE_APPROVAL_STEPS = [
  "create_or_load_brief",
  "develop_story_blueprint",
  "draft_script",
  "plan_shots",
  "plan_visual_anchors",
  "generate_anchor",
  "generate_storyboard",
  "generate_keyframe",
  "generate_clip",
  "generate_audio",
  "assemble_timeline",
  "critique_timeline",
  "export_video",
] as const satisfies readonly ReviewableApprovalStep[];

const reviewableApprovalSteps = new Set<string>(REVIEWABLE_APPROVAL_STEPS);

const str = { type: "string" } as const;

export const requestApprovalInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    step: {
      type: "string",
      enum: REVIEWABLE_APPROVAL_STEPS,
      description: "Tool whose output the user should review and whose stage should rerun on reject.",
    },
    previewArtifactIds: {
      type: "array",
      items: str,
      description: "Artifact ids the UI should preview while the run is parked.",
    },
    note: {
      type: "string",
      description: "Optional note explaining what the user should review.",
    },
  },
  required: ["step"],
};

export const requestApprovalOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    gateId: str,
    step: { type: "string", enum: REVIEWABLE_APPROVAL_STEPS },
    previewArtifactIds: { type: "array", items: str },
  },
  required: ["gateId", "step", "previewArtifactIds"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ToolInputError(`request_approval ${field} must be an array of strings.`, {
      field,
      expected: "string[]",
    });
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new ToolInputError(`request_approval ${field}[${index}] must be a non-empty string.`, {
        field,
        index,
      });
    }
    return item.trim();
  });
}

export function parseRequestApprovalInput(input: unknown): RequestApprovalInput {
  if (!isRecord(input)) {
    throw new ToolInputError("request_approval input must be an object.", {
      expected: requestApprovalInputSchema,
    });
  }

  if (typeof input.step !== "string" || input.step.trim().length === 0) {
    throw new ToolInputError("request_approval step must be a non-empty string.", {
      field: "step",
    });
  }
  const step = input.step.trim();
  if (!reviewableApprovalSteps.has(step)) {
    throw new ToolInputError("request_approval step must name the tool being reviewed.", {
      field: "step",
      expected: REVIEWABLE_APPROVAL_STEPS,
    });
  }

  if (input.note !== undefined && typeof input.note !== "string") {
    throw new ToolInputError("request_approval note must be a string.", {
      field: "note",
    });
  }

  const previewArtifactIds = parseStringArray(input.previewArtifactIds, "previewArtifactIds");
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim() : undefined;
  return {
    step: step as ReviewableApprovalStep,
    previewArtifactIds,
    ...(note ? { note } : {}),
  };
}

function missingRun(): ToolCallResult<RequestApprovalOutput> {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: "request_approval requires an orchestratorRunId in the execution context.",
      recoverable: false,
    },
  };
}

export function createRequestApprovalTool(
  deps: Partial<RequestApprovalDeps> = {}
): ToolDefinition<RequestApprovalInput, RequestApprovalOutput> {
  const resolved = { ...defaultDeps, ...deps };

  return {
    name: "request_approval",
    description:
      "Pause the run at a user approval gate before continuing with expensive or user-visible work.",
    usage: {
      preconditions: ["A durable orchestrator run is active."],
      produces: ["A reached approval gate that the existing approve/reject routes can resolve."],
      useWhen: [
        "The user should inspect a tool's previews or notes before the next expensive stage.",
        "A generation policy or user setting asks for a manual review stop; set step to the reviewed tool so reject can rerun it.",
      ],
    },
    inputSchema: requestApprovalInputSchema,
    outputSchema: requestApprovalOutputSchema,
    execution: "approval",
    parseInput: parseRequestApprovalInput,
    estimateCost: () => ({
      estimatedCostUsd: 0,
      unit: "approval_gate",
      notes: "Approval gates do not call providers.",
    }),
    async execute(input, context) {
      if (!context.orchestratorRunId) return missingRun();

      const gate = await resolved.createReachedApprovalGate({
        runId: context.orchestratorRunId,
        stage: input.step,
      });

      return {
        status: "waiting_for_approval",
        gateId: gate.id,
        resumesWhen: "approval_terminal",
        previewArtifactIds: input.previewArtifactIds,
      };
    },
  };
}
