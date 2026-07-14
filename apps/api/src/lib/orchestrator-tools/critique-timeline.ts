import {
  addProjectTimelineCritique as realAddProjectTimelineCritique,
  getActiveProjectTimelineAsset as realGetActiveProjectTimelineAsset,
  listAssets as realListAssets,
  type V1Asset,
} from "@/lib/api/v1/store";
import { critique as realCritique } from "@/lib/agent";
import {
  type Clip,
  type ShotPlan,
  singleSceneFromBeats,
  type Timeline,
} from "@popcorn/shared/types";
import { toolDefinitionMetadata } from "./capability-catalog";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";

export type CritiqueTimelineInput = Record<string, never>;

export interface CritiqueTimelineOutput {
  timelineId: string;
  timelineAssetId: string;
  critiqueAssetId: string;
  report: Awaited<ReturnType<typeof realCritique>>["report"];
}

export interface CritiqueTimelineDeps {
  getActiveProjectTimelineAsset: typeof realGetActiveProjectTimelineAsset;
  listAssets: typeof realListAssets;
  critique: typeof realCritique;
  addProjectTimelineCritique: typeof realAddProjectTimelineCritique;
}

const defaultDeps: CritiqueTimelineDeps = {
  getActiveProjectTimelineAsset: realGetActiveProjectTimelineAsset,
  listAssets: realListAssets,
  critique: realCritique,
  addProjectTimelineCritique: realAddProjectTimelineCritique,
};

const str = { type: "string" } as const;
const num = { type: "number" } as const;

export const critiqueTimelineInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
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
  },
  required: ["timelineId", "timelineAssetId", "critiqueAssetId", "report"],
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
  const extra = Object.keys(input);
  if (extra.length > 0) {
    throw new ToolInputError("critique_timeline received unsupported fields.", {
      unsupportedFields: extra,
    });
  }
  return {};
}

function isTimeline(value: unknown): value is Timeline {
  if (!isRecord(value)) return false;
  return (
    typeof value.aspectRatio === "string" &&
    typeof value.fps === "number" &&
    Array.isArray(value.segments)
  );
}

function planFromTimeline(timeline: Timeline): ShotPlan {
  const beatsByName = new Map<string, { id?: string; name: string; intent: string }>();
  for (const segment of timeline.segments) {
    const name = segment.role || segment.beatId || "beat";
    if (!beatsByName.has(name)) {
      beatsByName.set(name, {
        ...(segment.beatId ? { id: segment.beatId } : {}),
        name,
        intent: segment.reason || "",
      });
    }
  }
  return {
    targetLengthSec: 0,
    style: "",
    aspectRatio: timeline.aspectRatio,
    scenes: singleSceneFromBeats(
      [...beatsByName.values()].map((beat, index) => ({
        id: beat.id ?? `beat_${index + 1}_${beat.name || "untitled"}`,
        name: beat.name,
        intent: beat.intent,
        durationSec: 0,
      }))
    ),
  };
}

function assetToClip(asset: V1Asset): Clip {
  return {
    id: asset.id,
    filename: asset.filename,
    url: asset.remoteUrl ?? "",
    kind: asset.kind,
    durationSec: asset.durationSec ?? 0,
    description:
      asset.clipUnderstanding?.combinedSummary ||
      asset.assetKnowledge?.knowledgeSummary ||
      asset.context?.summary ||
      "",
    source: asset.source.type === "generated" ? "generated" : "upload",
  };
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
            "The critic reviews the assembled cut and needs the active timeline graph asset.",
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
    ...toolDefinitionMetadata("critique_timeline"),
    description:
      "Review the active assembled timeline graph asset and persist advisory critique notes. Requires assemble_timeline first.",
    usage: {
      preconditions: [
        "An active timeline graph asset exists (call assemble_timeline first).",
      ],
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
    parseInput: parseCritiqueTimelineInput,
    estimateCost: () => ({
      estimatedCostUsd: 0,
      unit: "model_call",
      notes: "Timeline critique is a cheap structured agent call and does not spend media budget.",
    }),
    async execute(input, context) {
      void input;
      if (!context.projectId) return missingProject();

      const activeTimeline = await resolved.getActiveProjectTimelineAsset({
        workspaceId: context.auth.workspaceId,
        projectId: context.projectId,
      });
      if (!activeTimeline || !isTimeline(activeTimeline.timeline)) return timelineRequired();

      const referencedClipIds = new Set(activeTimeline.timeline.segments.map((s) => s.clipId));
      const assetsPage = await resolved.listAssets(
        context.auth.workspaceId,
        context.projectId,
        1000,
        null
      );
      const clips = assetsPage.items
        .filter((asset) => referencedClipIds.has(asset.id))
        .map(assetToClip);

      const critique = await resolved.critique({
        plan: planFromTimeline(activeTimeline.timeline),
        timeline: activeTimeline.timeline,
        clips,
        storyContext: null,
      });

      const { critiqueAssetId } = await resolved.addProjectTimelineCritique({
        workspaceId: context.auth.workspaceId,
        projectId: context.projectId,
        timelineAssetId: activeTimeline.assetId,
        timelineContentHash: activeTimeline.contentHash,
        critique: {
          timelineId: activeTimeline.timelineId,
          report: critique.report,
        },
      });

      return {
        status: "succeeded",
        resourceIds: [critiqueAssetId],
        artifactIds: [critiqueAssetId],
        output: {
          timelineId: activeTimeline.timelineId,
          timelineAssetId: activeTimeline.assetId,
          critiqueAssetId,
          report: critique.report,
        },
      };
    },
  };
}
