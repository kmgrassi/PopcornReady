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
import { sanitizeTimeline } from "@popcorn/timeline/timeline";
import { planBeats, type Clip, type Timeline } from "@popcorn/shared/types";
import type { GraphAssetInput } from "@/lib/api/v1/asset-graph";
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

function roleAwareClip(asset: V1Asset, slotRole?: string): Clip {
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

function graphInputsFor(
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

function defaultGoal(plan: Awaited<ReturnType<typeof realGetActiveProjectPlan>>): string {
  if (!plan) return "Assemble a timeline.";
  return (
    planBeats(plan.plan)
      .map((beat) => beat.intent)
      .filter(Boolean)
      .join(" ") || "Assemble a timeline."
  );
}

async function loadAssemblyAssets(input: {
  deps: AssembleTimelineDeps;
  workspaceId: string;
  projectId: string;
  beatSlotRoles: string[];
}): Promise<{
  selectedBeatClips: ActiveAssetSelection[];
  missingBeatIds: string[];
  clips: Clip[];
  inputAssets: V1Asset[];
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
  const uploadsAndAudio = allAssets.items.filter((asset) => {
    if (asset.status !== "ready") return false;
    if (asset.kind === "audio") return asset.role === "voiceover" || asset.role === "soundtrack";
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

  return { selectedBeatClips, missingBeatIds, clips, inputAssets };
}

export function createAssembleTimelineTool(
  deps: Partial<AssembleTimelineDeps> = {}
): ToolDefinition<AssembleTimelineInput, AssembleTimelineOutput> {
  const resolved = { ...defaultDeps, ...deps };

  return {
    name: "assemble_timeline",
    description:
      "Assemble selected beat clips, uploads, and audio into the project's active deterministic timeline. Requires a plan and selected beat_clip assets.",
    usage: {
      preconditions: [
        "An active shot plan exists (call plan_shots first).",
        "Each planned beat has an active beat_clip selection (call generate_clip first).",
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
    execution: "sync",
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
      const beatSlotRoles = beats.map((beat, index) => {
        const beatId = beat.id || `beat_${index + 1}`;
        return `beat_clip:${beatId}`;
      });
      const { missingBeatIds, clips, inputAssets } = await loadAssemblyAssets({
        deps: resolved,
        workspaceId: context.auth.workspaceId,
        projectId: context.projectId,
        beatSlotRoles,
      });
      if (missingBeatIds.length > 0 || clips.filter((c) => (c.kind || "video") !== "audio").length === 0) {
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

        const draft = await resolved.selectClips({
          plan: activePlan.plan,
          clips,
          goal: input.goal ?? defaultGoal(activePlan),
          storyContext: null,
        });
        const timeline: Timeline = sanitizeTimeline(
          input.showCaptions === undefined
            ? draft
            : { ...draft, showCaptions: input.showCaptions },
          clips
        );
        if (timeline.segments.length === 0) {
          throw new Error("Assembled timeline has no valid segments.");
        }

        const graphInputs = graphInputsFor(activePlan, inputAssets);
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
