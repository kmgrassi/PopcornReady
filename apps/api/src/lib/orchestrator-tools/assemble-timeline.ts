import { selectClips as realSelectClips } from "@/lib/agent";
import {
  addProjectTimeline as realAddProjectTimeline,
  createAction as realCreateAction,
  getActiveProjectPlan as realGetActiveProjectPlan,
  listActiveProjectAssetSelections as realListActiveProjectAssetSelections,
  listAssets as realListAssets,
  updateAction as realUpdateAction,
  type ActiveAssetSelection,
  type V1Action,
  type V1Asset,
} from "@/lib/api/v1/store";
import { withLlmCostRecording } from "@/lib/api/v1/llm-costs";
import { sanitizeTimeline } from "@popcorn/timeline/timeline";
import { planBeats, type Clip, type ShotPlan, type Timeline } from "@popcorn/shared/types";
import type { GraphAssetInput } from "@/lib/api/v1/asset-graph";
import { selectedUploadedFootageAssetIds } from "@/lib/orchestrator/uploaded-footage-selection";
import { toolDefinitionMetadata } from "./capability-catalog";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";

export interface AssembleTimelineInput {
  goal?: string;
  showCaptions?: boolean;
}

export interface AssembleTimelineOutput {
  timelineAssetId: string;
  segmentCount: number;
  inputAssetIds: string[];
}

export interface AssembleTimelineDeps {
  getActiveProjectPlan: typeof realGetActiveProjectPlan;
  listActiveProjectAssetSelections: typeof realListActiveProjectAssetSelections;
  listAssets: typeof realListAssets;
  selectClips: typeof realSelectClips;
  createAction: typeof realCreateAction;
  updateAction: typeof realUpdateAction;
  addProjectTimeline: typeof realAddProjectTimeline;
}

const defaultDeps: AssembleTimelineDeps = {
  getActiveProjectPlan: realGetActiveProjectPlan,
  listActiveProjectAssetSelections: realListActiveProjectAssetSelections,
  listAssets: realListAssets,
  selectClips: realSelectClips,
  createAction: realCreateAction,
  updateAction: realUpdateAction,
  addProjectTimeline: realAddProjectTimeline,
};

const str = { type: "string" } as const;

export const assembleTimelineInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    goal: {
      ...str,
      description:
        "Optional assembly goal or editorial emphasis. Omit to derive it from the active plan.",
    },
    showCaptions: {
      type: "boolean",
      description: "Optional caption overlay preference to persist on the timeline.",
    },
  },
  required: [],
} as const;

export const assembleTimelineOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    timelineAssetId: str,
    segmentCount: { type: "number" },
    inputAssetIds: { type: "array", items: str },
  },
  required: ["timelineAssetId", "segmentCount", "inputAssetIds"],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAssembleTimelineInput(input: unknown): AssembleTimelineInput {
  if (input === undefined || input === null) return {};
  if (!isRecord(input)) {
    throw new ToolInputError("assemble_timeline input must be an object.", {
      expected: assembleTimelineInputSchema,
    });
  }
  const allowed = new Set(["goal", "showCaptions"]);
  const extra = Object.keys(input).filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    throw new ToolInputError("assemble_timeline received unsupported fields.", {
      unsupportedFields: extra,
    });
  }
  if (input.goal !== undefined && typeof input.goal !== "string") {
    throw new ToolInputError("assemble_timeline goal must be a string.", {});
  }
  if (input.showCaptions !== undefined && typeof input.showCaptions !== "boolean") {
    throw new ToolInputError("assemble_timeline showCaptions must be a boolean.", {});
  }
  const goal = input.goal?.trim();
  return {
    ...(goal ? { goal } : {}),
    ...(input.showCaptions === undefined ? {} : { showCaptions: input.showCaptions }),
  };
}

function planRequired(): ToolCallResult<AssembleTimelineOutput> {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: "assemble_timeline needs a shot plan before it can build a cut.",
      recoverable: true,
      unmetRequirements: [
        {
          requirement: "plan",
          because: "Timeline assembly orders selected clips against the active planned beats.",
          satisfyWith: { tool: "plan_shots", inputHint: {} },
        },
      ],
      suggestedNextTools: [{ tool: "plan_shots", inputHint: {} }],
    },
  };
}

function beatClipsRequired(missingBeatIds: string[]): ToolCallResult<AssembleTimelineOutput> {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: "assemble_timeline needs selected beat_clip assets before it can build a cut.",
      recoverable: true,
      unmetRequirements: [
        {
          requirement: "beat_clip",
          because:
            missingBeatIds.length > 0
              ? `No active beat_clip selection exists for beats: ${missingBeatIds.join(", ")}.`
              : "No active generated beat clips are selected for the project.",
          satisfyWith: { tool: "generate_clip", inputHint: {} },
        },
      ],
      suggestedNextTools: [{ tool: "generate_clip", inputHint: {} }],
    },
  };
}

export function roleAwareClip(asset: V1Asset, slotRole?: string): Clip {
  const role = asset.role ?? "upload";
  const slot = slotRole ? ` slot=${slotRole}` : "";
  const base =
    asset.context?.summary ||
    asset.userContext?.description ||
    asset.assetKnowledge?.knowledgeSummary ||
    asset.clipUnderstanding?.combinedSummary ||
    "";
  return {
    id: asset.id,
    filename: asset.filename,
    url: asset.remoteUrl ?? asset.storageKey ?? "",
    kind: asset.kind,
    durationSec: asset.durationSec ?? 0,
    source: asset.source.type === "generated" ? "generated" : "upload",
    description: `[role=${role}${slot}] ${base}`.trim(),
  };
}

function uniqueAssets(assets: V1Asset[]): V1Asset[] {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    if (seen.has(asset.id)) return false;
    seen.add(asset.id);
    return true;
  });
}

export function sortTimelineByAssetOrder(timeline: Timeline, assetIds: string[]): Timeline {
  if (assetIds.length === 0) return timeline;
  const order = new Map(assetIds.map((id, index) => [id, index]));
  const segments = timeline.segments
    .map((segment, index) => ({ segment, index }))
    .sort((a, b) => {
      const aOrder = order.get(a.segment.clipId) ?? Number.MAX_SAFE_INTEGER;
      const bOrder = order.get(b.segment.clipId) ?? Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder || a.index - b.index;
    })
    .map(({ segment }, index) => ({ ...segment, id: segment.id || `seg_${index + 1}` }));
  return { ...timeline, segments };
}

export function graphInputsFor(
  plan: { assetId: string; contentHash: string },
  assets: V1Asset[]
): GraphAssetInput[] {
  const inputs: GraphAssetInput[] = [
    {
      assetId: plan.assetId,
      relation: "input",
      role: "plan",
      position: 0,
      ...(plan.contentHash ? { contentHash: plan.contentHash } : {}),
    },
  ];
  uniqueAssets(assets).forEach((asset, index) => {
    inputs.push({
      assetId: asset.id,
      relation: "input",
      role: asset.role ?? asset.kind,
      position: index + 1,
      ...(asset.contentHash ? { contentHash: asset.contentHash } : {}),
    });
  });
  return inputs;
}

export function defaultAssemblyGoal(plan: { plan: ShotPlan } | null): string {
  if (!plan) return "Assemble a timeline.";
  return (
    planBeats(plan.plan)
      .map((beat) => beat.intent)
      .filter(Boolean)
      .join(" ") || "Assemble a timeline."
  );
}

export async function assembleTimelineDraft(input: {
  plan: ShotPlan;
  planAsset: { assetId: string; contentHash: string };
  assets: V1Asset[];
  causalAssets?: V1Asset[];
  goal?: string;
  selectedAssetIds?: string[];
  showCaptions?: boolean;
  selectClips?: typeof realSelectClips;
}): Promise<{ timeline: Timeline; graphInputs: GraphAssetInput[] }> {
  const clips = input.assets.map((asset) => roleAwareClip(asset));
  if (clips.filter((clip) => (clip.kind || "video") !== "audio").length === 0) {
    throw new Error("Assembled timeline requires at least one visual clip.");
  }
  const draft = await (input.selectClips ?? realSelectClips)({
    plan: input.plan,
    clips,
    goal: input.goal ?? defaultAssemblyGoal({ plan: input.plan }),
    storyContext: null,
  });
  const timeline = sortTimelineByAssetOrder(
    sanitizeTimeline(
      input.showCaptions === undefined
        ? draft
        : { ...draft, showCaptions: input.showCaptions },
      clips
    ),
    input.selectedAssetIds ?? []
  );
  if (timeline.segments.length === 0) {
    throw new Error("Assembled timeline has no valid segments.");
  }
  return {
    timeline,
    graphInputs: graphInputsFor(input.planAsset, input.causalAssets ?? input.assets),
  };
}

async function loadAssemblyAssets(input: {
  deps: AssembleTimelineDeps;
  workspaceId: string;
  projectId: string;
  beatSlotRoles: string[];
  selectedUploadAssetIds?: string[];
}): Promise<{
  selectedBeatClips: ActiveAssetSelection[];
  missingBeatIds: string[];
  clips: Clip[];
  inputAssets: V1Asset[];
  hasSelectedUploadSources: boolean;
}> {
  const selectedBeatClips = await input.deps.listActiveProjectAssetSelections({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    slotRoles: input.beatSlotRoles,
  });
  const selectedSlots = new Set(selectedBeatClips.map((selection) => selection.slotRole));
  const missingBeatIds = input.beatSlotRoles
    .filter((slot) => !selectedSlots.has(slot))
    .map((slot) => slot.replace(/^beat_clip:/, ""));

  const allAssets = await input.deps.listAssets(input.workspaceId, input.projectId, 500, null);
  const selectedUploadAssetIds = input.selectedUploadAssetIds ?? [];
  const selectedOrder = new Map(selectedUploadAssetIds.map((id, index) => [id, index]));
  const readyAssets = allAssets.items.filter((asset) => asset.status === "ready");
  const readyAudioAssets = readyAssets.filter(
    (asset) =>
      asset.kind === "audio" && (asset.role === "voiceover" || asset.role === "soundtrack")
  );
  const uploadsAndAudio =
    selectedUploadAssetIds.length > 0
      ? [
          ...readyAssets
            .filter((asset) => selectedOrder.has(asset.id) && asset.kind !== "audio")
            .sort((a, b) => selectedOrder.get(a.id)! - selectedOrder.get(b.id)!),
          ...readyAudioAssets,
        ]
      : readyAssets.filter((asset) => {
          if (asset.kind === "audio") {
            return asset.role === "voiceover" || asset.role === "soundtrack";
          }
          return asset.source.type !== "generated" || asset.role === "upload";
        });
  const inputAssets = uniqueAssets([
    ...selectedBeatClips.map((selection) => selection.asset),
    ...uploadsAndAudio,
  ]);
  const clips = [
    ...selectedBeatClips.map((selection) => roleAwareClip(selection.asset, selection.slotRole)),
    ...uploadsAndAudio.map((asset) => roleAwareClip(asset)),
  ];

  return {
    selectedBeatClips,
    missingBeatIds,
    clips,
    inputAssets,
    hasSelectedUploadSources: selectedUploadAssetIds.length > 0,
  };
}

export function createAssembleTimelineTool(
  deps: Partial<AssembleTimelineDeps> = {}
): ToolDefinition<AssembleTimelineInput, AssembleTimelineOutput> {
  const resolved = { ...defaultDeps, ...deps };

  return {
    ...toolDefinitionMetadata("assemble_timeline"),
    description:
      "Assemble selected beat clips, uploads, and audio into the project's active deterministic timeline. Requires a plan plus selected uploads or selected beat_clip assets.",
    usage: {
      preconditions: [
        "An active shot plan exists (call plan_shots first).",
        "Uploaded-footage runs carry ordered selected asset ids; generated runs need each planned beat to have an active beat_clip selection (call generate_clip first).",
      ],
      produces: [
        "A timeline composite asset selected as the active cut, with provenance edges to the plan, clips, uploads, and audio assets.",
      ],
      useWhen: [
        "Generated beat clips are ready and the project needs a first cut before critique or export.",
        "Uploads and generated media need to be ordered into a deterministic timeline.",
      ],
    },
    inputSchema: assembleTimelineInputSchema,
    outputSchema: assembleTimelineOutputSchema,
    parseInput: parseAssembleTimelineInput,
    estimateCost: () => ({
      estimatedCostUsd: 0,
      unit: "model_call",
      notes: "Timeline assembly is a structured selection call; media generation has already happened.",
    }),
    async execute(input, context) {
      if (!context.projectId) {
        return {
          status: "failed",
          error: {
            kind: "precondition_unmet",
            message: "assemble_timeline requires a projectId in the execution context.",
            recoverable: false,
          },
        };
      }

      const activePlan = await resolved.getActiveProjectPlan(context.projectId);
      if (!activePlan) return planRequired();

      const beats = planBeats(activePlan.plan);
      const selectedUploadAssetIds = selectedUploadedFootageAssetIds(context.metadata) ?? [];
      const beatSlotRoles = beats.map((beat, index) => {
        const beatId = beat.id || `beat_${index + 1}`;
        return `beat_clip:${beatId}`;
      });
      const { missingBeatIds, clips, inputAssets, hasSelectedUploadSources } =
        await loadAssemblyAssets({
          deps: resolved,
          workspaceId: context.auth.workspaceId,
          projectId: context.projectId,
          beatSlotRoles,
          selectedUploadAssetIds,
        });
      if (
        (!hasSelectedUploadSources && missingBeatIds.length > 0) ||
        clips.filter((c) => (c.kind || "video") !== "audio").length === 0
      ) {
        return beatClipsRequired(missingBeatIds);
      }

      let action: V1Action | null = null;
      try {
        action = await resolved.createAction({
          projectId: context.projectId,
          orchestratorRunId: context.orchestratorRunId,
          tool: "assemble_timeline",
          status: "running",
          params: { source: "assemble_timeline" },
          inputAssetIds: [activePlan.assetId, ...inputAssets.map((asset) => asset.id)],
          rationale: "Assemble selected media assets into the active timeline.",
        });

        const assembled = await withLlmCostRecording(
          {
            projectId: context.projectId,
            runId: context.orchestratorRunId,
            actionId: action.id,
          },
          () =>
            assembleTimelineDraft({
              plan: activePlan.plan,
              planAsset: activePlan,
              assets: inputAssets,
              goal: input.goal ?? defaultAssemblyGoal(activePlan),
              selectedAssetIds: selectedUploadAssetIds,
              showCaptions: input.showCaptions,
              selectClips: resolved.selectClips,
            })
        );
        const { timeline, graphInputs } = assembled;
        const { timelineAssetId } = await resolved.addProjectTimeline({
          workspaceId: context.auth.workspaceId,
          projectId: context.projectId,
          timeline,
          graphInputs,
          createdByActionId: action.id,
        });
        await resolved.updateAction(action.id, {
          status: "applied",
          outputAssetIds: [timelineAssetId],
        });

        return {
          status: "succeeded",
          resourceIds: [timelineAssetId],
          artifactIds: [timelineAssetId],
          output: {
            timelineAssetId,
            segmentCount: timeline.segments.length,
            inputAssetIds: graphInputs.map((assetInput) => assetInput.assetId),
          },
        };
      } catch (error) {
        if (action) {
          await resolved.updateAction(action.id, {
            status: "failed",
            error: {
              code: "timeline_assembly_failed",
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
        throw error;
      }
    },
  };
}
