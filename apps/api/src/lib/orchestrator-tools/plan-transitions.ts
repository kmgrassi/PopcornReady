import {
  getActiveProjectPlan as realGetActiveProjectPlan,
  getProjectStoryboard as realGetProjectStoryboard,
  insertProjectTransition as realInsertProjectTransition,
  listActiveProjectAssetSelections as realListActiveProjectAssetSelections,
} from "@/lib/api/v1/store";
import type { ShotPlan } from "@popcorn/shared/types";
import type { TransitionContent } from "@popcorn/shared/transitions";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";

export interface PlanTransitionsInput {
  feedback?: string;
}

export interface PlanTransitionsOutput {
  transitionAssetIds: string[];
  boundaryCount: number;
}

// One boundary between consecutive beats, with whether it crosses a scene.
interface Boundary {
  fromBeatId: string;
  toBeatId: string;
  sameScene: boolean;
}

export interface PlanTransitionsDeps {
  getActiveProjectPlan: typeof realGetActiveProjectPlan;
  getProjectStoryboard: typeof realGetProjectStoryboard;
  listActiveProjectAssetSelections: typeof realListActiveProjectAssetSelections;
  insertProjectTransition: typeof realInsertProjectTransition;
  // Decide a boundary's transition. Returns null for a hard cut — which is the
  // empty-slot default, so nothing is persisted. Injectable so an LLM-backed
  // decider can replace the heuristic.
  decideTransition: (boundary: Boundary, feedback?: string) => TransitionContent | null;
}

// Default heuristic: a within-scene boundary is a hard cut (left empty); a
// scene-crossing boundary gets a short crossfade. An LLM decider can supersede
// this with beat-aware choices and ranked alternatives.
function defaultDecideTransition(boundary: Boundary): TransitionContent | null {
  if (boundary.sameScene) return null;
  return {
    method: "effect",
    type: "crossfade",
    durationMs: 400,
    params: {},
    reason: "scene_change",
    confidence: 0.6,
  };
}

const defaultDeps: PlanTransitionsDeps = {
  getActiveProjectPlan: realGetActiveProjectPlan,
  getProjectStoryboard: realGetProjectStoryboard,
  listActiveProjectAssetSelections: realListActiveProjectAssetSelections,
  insertProjectTransition: realInsertProjectTransition,
  decideTransition: defaultDecideTransition,
};

const str = { type: "string" } as const;

export const planTransitionsInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    feedback: {
      type: "string",
      description: "Optional instruction to bias the transition choices.",
    },
    revisionInstruction: {
      type: "string",
      description: "Alias used by approval-rejection retries.",
    },
  },
  required: [],
} as const;

export const planTransitionsOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    transitionAssetIds: { type: "array", items: str },
    boundaryCount: { type: "number" },
  },
  required: ["transitionAssetIds", "boundaryCount"],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePlanTransitionsInput(input: unknown): PlanTransitionsInput {
  if (input === undefined || input === null) return {};
  if (!isRecord(input)) {
    throw new ToolInputError("plan_transitions input must be an object.", {
      expected: planTransitionsInputSchema,
    });
  }
  const allowed = new Set(["feedback", "revisionInstruction"]);
  const extra = Object.keys(input).filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    throw new ToolInputError("plan_transitions received unsupported fields.", {
      unsupportedFields: extra,
    });
  }
  const feedback = input.feedback;
  if (feedback !== undefined && typeof feedback !== "string") {
    throw new ToolInputError("plan_transitions feedback must be a string.", {});
  }
  const revisionInstruction = input.revisionInstruction;
  if (revisionInstruction !== undefined && typeof revisionInstruction !== "string") {
    throw new ToolInputError("plan_transitions revisionInstruction must be a string.", {});
  }
  const instruction = feedback ?? revisionInstruction;
  return instruction && instruction.trim() ? { feedback: instruction.trim() } : {};
}

const BEAT_CLIP_PREFIX = "beat_clip:";

function orderedPlanBeats(plan: ShotPlan): Array<{ beatId: string; sceneId: string }> {
  return plan.scenes.flatMap((scene, sceneIndex) =>
    scene.beats.flatMap((beat) => {
      if (!beat.id) return [];
      return [{ beatId: beat.id, sceneId: scene.id || `scene_${sceneIndex + 1}` }];
    })
  );
}

function clipsRequired(): ToolCallResult<PlanTransitionsOutput> {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: "plan_transitions needs generated clips before it can join them.",
      recoverable: true,
      unmetRequirements: [
        {
          requirement: "beat_clip",
          because: "A transition links two beats' clips, so the clips must exist first.",
          satisfyWith: { tool: "generate_clip", inputHint: {} },
        },
      ],
      suggestedNextTools: [{ tool: "generate_clip", inputHint: {} }],
    },
  };
}

export function createPlanTransitionsTool(
  deps: Partial<PlanTransitionsDeps> = {}
): ToolDefinition<PlanTransitionsInput, PlanTransitionsOutput> {
  const resolved = { ...defaultDeps, ...deps };

  return {
    name: "plan_transitions",
    description:
      "Decide the transition between each pair of consecutive beats and persist the non-default ones as transition assets. Within-scene boundaries stay hard cuts (no asset); scene changes get an effect transition. Requires generated clips.",
    usage: {
      preconditions: ["Beat clips exist (call generate_clip first)."],
      produces: [
        "Transition assets for boundaries that need more than a hard cut, selected into the transition:${fromBeatId} slots.",
      ],
      useWhen: [
        "Before assembling the timeline, to choose how consecutive clips are joined.",
      ],
    },
    inputSchema: planTransitionsInputSchema,
    outputSchema: planTransitionsOutputSchema,
    execution: "sync",
    parseInput: parsePlanTransitionsInput,
    estimateCost: () => ({
      estimatedCostUsd: 0,
      unit: "db_write",
      notes: "Effect transitions are decisions persisted as graph assets — no provider spend.",
    }),
    async execute(input, context) {
      if (!context.projectId) {
        return {
          status: "failed",
          error: {
            kind: "precondition_unmet",
            message: "plan_transitions requires a projectId in the execution context.",
            recoverable: false,
          },
        };
      }
      const workspaceId = context.auth.workspaceId;
      const projectId = context.projectId;

      const storyboard = await resolved.getProjectStoryboard(workspaceId, projectId);
      if (!storyboard || storyboard.scenes.length === 0) {
        return { status: "succeeded", resourceIds: [], output: { transitionAssetIds: [], boundaryCount: 0 } };
      }

      const activePlan = await resolved.getActiveProjectPlan(projectId);
      if (!activePlan) return clipsRequired();

      // Clip selections are keyed by shot-plan beat ids. Storyboard rows may have
      // independent ids, so the plan remains the boundary id source.
      const orderedBeats = orderedPlanBeats(activePlan.plan);
      if (orderedBeats.length < 2) {
        return { status: "succeeded", resourceIds: [], output: { transitionAssetIds: [], boundaryCount: 0 } };
      }

      const boundaries: Boundary[] = [];
      for (let i = 0; i < orderedBeats.length - 1; i += 1) {
        const from = orderedBeats[i];
        const to = orderedBeats[i + 1];
        boundaries.push({
          fromBeatId: from.beatId,
          toBeatId: to.beatId,
          sameScene: from.sceneId === to.sceneId,
        });
      }

      // Resolve each beat's active clip (boundaries are joined by their clips).
      const clipSelections = await resolved.listActiveProjectAssetSelections({
        workspaceId,
        projectId,
        slotRoles: orderedBeats.map((beat) => `${BEAT_CLIP_PREFIX}${beat.beatId}`),
      });
      const clipByBeatId = new Map<string, string>();
      for (const selection of clipSelections) {
        if (!selection.slotRole.startsWith(BEAT_CLIP_PREFIX)) continue;
        clipByBeatId.set(selection.slotRole.slice(BEAT_CLIP_PREFIX.length), selection.asset.id);
      }
      if (clipByBeatId.size === 0) return clipsRequired();

      const transitionAssetIds: string[] = [];
      for (const boundary of boundaries) {
        const content = resolved.decideTransition(boundary, input.feedback);
        if (!content) continue; // hard cut → empty slot, nothing to persist
        const fromClipAssetId = clipByBeatId.get(boundary.fromBeatId);
        const toClipAssetId = clipByBeatId.get(boundary.toBeatId);
        if (!fromClipAssetId || !toClipAssetId) return clipsRequired();
        const { transitionAssetId } = await resolved.insertProjectTransition({
          workspaceId,
          projectId,
          fromBeatId: boundary.fromBeatId,
          fromClipAssetId,
          toClipAssetId,
          content,
        });
        transitionAssetIds.push(transitionAssetId);
      }

      return {
        status: "succeeded",
        resourceIds: transitionAssetIds,
        output: { transitionAssetIds, boundaryCount: boundaries.length },
      };
    },
  };
}
