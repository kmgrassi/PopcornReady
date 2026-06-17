import { TOOL_NAMES } from "@/lib/orchestrator/types";
import {
  createReachedGate as realCreateReachedGate,
  type OrchestratorRunGate,
} from "@/lib/api/v1/orchestrator-store";
import type { ToolCallResult, ToolDefinition, ToolName } from "./types";
import { ToolInputError } from "./types";

export interface RequestApprovalInput {
  step: ToolName;
  previewArtifactIds: string[];
  note?: string;
}

export interface RequestApprovalDeps {
  createReachedGate: typeof realCreateReachedGate;
}

const defaultDeps: RequestApprovalDeps = {
  createReachedGate: realCreateReachedGate,
};

const str = { type: "string" } as const;

export const requestApprovalInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    step: {
      type: "string",
      enum: TOOL_NAMES,
      description: "The tool/stage whose current output needs user approval.",
    },
    previewArtifactIds: {
      type: "array",
      items: str,
      description: "Artifact or asset ids the UI should show for review.",
    },
    note: {
      type: "string",
      description: "Optional short note explaining what the user should review.",
    },
  },
  required: ["step", "previewArtifactIds"],
} as const;

export const requestApprovalOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    gateId: str,
    resumesWhen: { type: "string", enum: ["approval_terminal"] },
    previewArtifactIds: { type: "array", items: str },
  },
  required: ["gateId", "resumesWhen", "previewArtifactIds"],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && TOOL_NAMES.includes(value as ToolName);
}

function parsePreviewArtifactIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new ToolInputError("request_approval previewArtifactIds must be an array.", {
      expected: requestApprovalInputSchema.properties.previewArtifactIds,
    });
  }
  const ids = value.map((item) => (typeof item === "string" ? item.trim() : ""));
  if (ids.some((id) => id.length === 0) || ids.length !== value.length) {
    throw new ToolInputError(
      "request_approval previewArtifactIds must contain only non-empty strings.",
      {}
    );
  }
  return ids;
}

export function parseRequestApprovalInput(input: unknown): RequestApprovalInput {
  if (!isRecord(input)) {
    throw new ToolInputError("request_approval input must be an object.", {
      expected: requestApprovalInputSchema,
    });
  }

  if (!isToolName(input.step)) {
    throw new ToolInputError("request_approval step must be a declared tool name.", {
      allowed: [...TOOL_NAMES],
    });
  }

  const previewArtifactIds = parsePreviewArtifactIds(input.previewArtifactIds);
  const note = input.note;
  if (note !== undefined && typeof note !== "string") {
    throw new ToolInputError("request_approval note must be a string.", {});
  }

  const trimmedNote = typeof note === "string" ? note.trim() : "";
  return {
    step: input.step,
    previewArtifactIds,
    ...(trimmedNote ? { note: trimmedNote } : {}),
  };
}

function missingRunId(): ToolCallResult {
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
): ToolDefinition<RequestApprovalInput> {
  const resolved = { ...defaultDeps, ...deps };

  return {
    name: "request_approval",
    description:
      "Open a user approval gate for the current output of a reviewed generation stage and park the run until the gate is approved or rejected.",
    usage: {
      preconditions: [
        "The stage being reviewed has produced preview artifacts or assets for the user to inspect.",
      ],
      produces: [
        "A reached approval gate that the UI can approve or reject; the orchestrator run parks until that decision.",
      ],
      useWhen: [
        "The user requested a review stop before continuing after a stage output.",
        "A potentially expensive or user-visible next step should wait for explicit approval.",
      ],
    },
    inputSchema: requestApprovalInputSchema,
    outputSchema: requestApprovalOutputSchema,
    execution: "approval",
    parseInput: parseRequestApprovalInput,
    estimateCost: () => ({
      estimatedCostUsd: 0,
      unit: "approval_gate",
      notes: "Approval gates only persist workflow state.",
    }),
    async execute(input, context) {
      if (!context.orchestratorRunId) return missingRunId();

      const gate: OrchestratorRunGate = await resolved.createReachedGate(
        context.orchestratorRunId,
        input.step
      );

      return {
        status: "waiting_for_approval",
        gateId: gate.id,
        resumesWhen: "approval_terminal",
        previewArtifactIds: input.previewArtifactIds,
      };
    },
  };
}
