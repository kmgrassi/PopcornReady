import {
  addProjectTimelineCritique as realAddProjectTimelineCritique,
  ensureProjectTimelineAsset as realEnsureProjectTimelineAsset,
} from "@/lib/api/v1/store";
import {
  getStore as realGetStore,
  type V1Store,
} from "@/lib/v1/store";
import {
  runTimelineCritique as realRunTimelineCritique,
  type CritiqueResult,
} from "@/lib/v1/assemble";
import type { VersionedTimeline } from "@popcorn/shared/v1/types";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";

export interface CritiqueTimelineInput {
  feedback?: string;
}

export interface CritiqueTimelineOutput {
  timelineId: string;
  timelineAssetId: string;
  critiqueAssetId: string;
  report: CritiqueResult["report"];
  patches: CritiqueResult["patches"];
}

export interface CritiqueTimelineDeps {
  getStore: typeof realGetStore;
  runTimelineCritique: typeof realRunTimelineCritique;
  ensureProjectTimelineAsset: typeof realEnsureProjectTimelineAsset;
  addProjectTimelineCritique: typeof realAddProjectTimelineCritique;
}

const defaultDeps: CritiqueTimelineDeps = {
  getStore: realGetStore,
  runTimelineCritique: realRunTimelineCritique,
  ensureProjectTimelineAsset: realEnsureProjectTimelineAsset,
  addProjectTimelineCritique: realAddProjectTimelineCritique,
};

const str = { type: "string" } as const;
const num = { type: "number" } as const;

export const critiqueTimelineInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    feedback: {
      type: "string",
      description:
        "Optional user or model note about what to emphasize while reviewing the timeline.",
    },
  },
  required: [],
} as const;

export const critiqueTimelineOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    timelineId: str,
    timelineAssetId: str,
    critiqueAssetId: str,
    report: {
      type: "object",
      additionalProperties: false,
      properties: {
        scores: {
          type: "object",
          additionalProperties: false,
          properties: {
            hook_score: num,
            clarity_score: num,
            pacing_score: num,
            visual_variety: num,
            script_coverage: num,
            emotional_arc: num,
            repetition_penalty: num,
          },
          required: [
            "hook_score",
            "clarity_score",
            "pacing_score",
            "visual_variety",
            "script_coverage",
            "emotional_arc",
            "repetition_penalty",
          ],
        },
        summary: str,
      },
      required: ["scores", "summary"],
    },
    patches: { type: "array", items: { type: "object" } },
  },
  required: ["timelineId", "timelineAssetId", "critiqueAssetId", "report", "patches"],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseCritiqueTimelineInput(input: unknown): CritiqueTimelineInput {
  if (input === undefined || input === null) return {};
  if (!isRecord(input)) {
    throw new ToolInputError("critique_timeline input must be an object.", {
      expected: critiqueTimelineInputSchema,
    });
  }
  const allowed = new Set(["feedback"]);
  const extra = Object.keys(input).filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    throw new ToolInputError("critique_timeline received unsupported fields.", {
      unsupportedFields: extra,
    });
  }
  if (input.feedback !== undefined && typeof input.feedback !== "string") {
    throw new ToolInputError("critique_timeline feedback must be a string.", {
      field: "feedback",
    });
  }
  const feedback = input.feedback?.trim();
  return feedback ? { feedback } : {};
}

async function latestTimeline(
  store: V1Store,
  projectId: string
): Promise<VersionedTimeline | null> {
  const timelines = await store.listTimelinesForProject(projectId);
  return timelines[0] ?? null;
}

function missingProject(): ToolCallResult<CritiqueTimelineOutput> {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: "critique_timeline requires a projectId in the execution context.",
      recoverable: false,
    },
  };
}

function timelineRequired(): ToolCallResult<CritiqueTimelineOutput> {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: "critique_timeline needs an active assembled timeline before it can run.",
      recoverable: true,
      unmetRequirements: [
        {
          requirement: "timeline",
          because:
            "The critic reviews the assembled cut and needs the current timeline asset as input.",
          satisfyWith: { tool: "assemble_timeline", inputHint: {} },
        },
      ],
      suggestedNextTools: [{ tool: "assemble_timeline", inputHint: {} }],
    },
  };
}

export function createCritiqueTimelineTool(
  deps: Partial<CritiqueTimelineDeps> = {}
): ToolDefinition<CritiqueTimelineInput, CritiqueTimelineOutput> {
  const resolved = { ...defaultDeps, ...deps };

  return {
    name: "critique_timeline",
    description:
      "Review the active assembled timeline and persist advisory critique notes. Requires assemble_timeline first.",
    usage: {
      preconditions: ["An active assembled timeline exists (call assemble_timeline first)."],
      produces: [
        "A persisted timeline_critique asset linked to the active timeline for downstream decisions.",
      ],
      useWhen: [
        "A timeline has been assembled and the agent needs quality notes before export.",
        "The model should decide whether targeted beat regeneration is needed or whether to continue to export.",
      ],
    },
    inputSchema: critiqueTimelineInputSchema,
    outputSchema: critiqueTimelineOutputSchema,
    execution: "sync",
    parseInput: parseCritiqueTimelineInput,
    estimateCost: () => ({
      estimatedCostUsd: 0,
      unit: "model_call",
      notes: "Timeline critique is a cheap structured agent call and does not spend media budget.",
    }),
    async execute(_input, context) {
      if (!context.projectId) return missingProject();

      const store = resolved.getStore();
      const timeline = await latestTimeline(store, context.projectId);
      if (!timeline) return timelineRequired();

      const timelineAsset = await resolved.ensureProjectTimelineAsset({
        workspaceId: context.auth.workspaceId,
        projectId: context.projectId,
        timelineId: timeline.id,
        timeline,
      });

      const critique = await resolved.runTimelineCritique({
        store,
        workspaceId: context.auth.workspaceId,
        projectId: context.projectId,
        timelineId: timeline.id,
      });

      const { critiqueAssetId } = await resolved.addProjectTimelineCritique({
        workspaceId: context.auth.workspaceId,
        projectId: context.projectId,
        timelineAssetId: timelineAsset.assetId,
        timelineContentHash: timelineAsset.contentHash,
        critique: {
          timelineId: critique.timelineId,
          report: critique.report,
          patches: critique.patches,
        },
      });

      return {
        status: "succeeded",
        resourceIds: [critiqueAssetId],
        artifactIds: [critiqueAssetId],
        output: {
          timelineId: critique.timelineId,
          timelineAssetId: timelineAsset.assetId,
          critiqueAssetId,
          report: critique.report,
          patches: critique.patches,
        },
      };
    },
  };
}
