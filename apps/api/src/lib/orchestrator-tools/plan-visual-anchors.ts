import {
  addProjectVisualAnchorPlan as realAddProjectVisualAnchorPlan,
  getActiveProjectPlan as realGetActiveProjectPlan,
  type VisualAnchorPlan,
  type VisualAnchorPlanItem,
} from "@/lib/api/v1/store";
import type { EditPlan, Scene } from "@popcorn/shared/types";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";

export interface PlanVisualAnchorsInput {
  feedback?: string;
}

export interface PlanVisualAnchorsOutput {
  visualAnchorPlan: VisualAnchorPlan;
  visualAnchorPlanAssetId: string;
}

export interface PlanVisualAnchorsDeps {
  getActiveProjectPlan: typeof realGetActiveProjectPlan;
  addProjectVisualAnchorPlan: typeof realAddProjectVisualAnchorPlan;
}

const defaultDeps: PlanVisualAnchorsDeps = {
  getActiveProjectPlan: realGetActiveProjectPlan,
  addProjectVisualAnchorPlan: realAddProjectVisualAnchorPlan,
};

const str = { type: "string" } as const;

const visualAnchorSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: str,
    kind: { type: "string", enum: ["character", "location", "style"] },
    label: str,
    description: str,
    sourceSceneIds: { type: "array", items: str },
    sourceBeatIds: { type: "array", items: str },
  },
  required: ["id", "kind", "label", "description", "sourceSceneIds", "sourceBeatIds"],
} as const;

export const visualAnchorPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "string", enum: ["visual_anchor_plan.v1"] },
    anchors: { type: "array", items: visualAnchorSchema },
  },
  required: ["schemaVersion", "anchors"],
} as const;

export const planVisualAnchorsInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    feedback: {
      type: "string",
      description: "Optional instruction to bias which recurring anchors are most important.",
    },
    revisionInstruction: {
      type: "string",
      description: "Alias used by approval-rejection retries.",
    },
  },
  required: [],
} as const;

export const planVisualAnchorsOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    visualAnchorPlan: visualAnchorPlanSchema,
    visualAnchorPlanAssetId: str,
  },
  required: ["visualAnchorPlan", "visualAnchorPlanAssetId"],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePlanVisualAnchorsInput(input: unknown): PlanVisualAnchorsInput {
  if (input === undefined || input === null) return {};
  if (!isRecord(input)) {
    throw new ToolInputError("plan_visual_anchors input must be an object.", {
      expected: planVisualAnchorsInputSchema,
    });
  }
  const allowed = new Set(["feedback", "revisionInstruction"]);
  const extra = Object.keys(input).filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    throw new ToolInputError("plan_visual_anchors received unsupported fields.", {
      unsupportedFields: extra,
    });
  }
  const feedback = input.feedback;
  if (feedback !== undefined && typeof feedback !== "string") {
    throw new ToolInputError("plan_visual_anchors feedback must be a string.", {});
  }
  const revisionInstruction = input.revisionInstruction;
  if (revisionInstruction !== undefined && typeof revisionInstruction !== "string") {
    throw new ToolInputError("plan_visual_anchors revisionInstruction must be a string.", {});
  }
  const instruction = feedback ?? revisionInstruction;
  return instruction && instruction.trim() ? { feedback: instruction.trim() } : {};
}

function slug(value: string): string {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "anchor";
}

function beatIds(scene: Scene): string[] {
  return (scene.beats ?? []).map((beat, index) => beat.id ?? `${scene.id}_beat_${index + 1}`);
}

function sceneSummary(scene: Scene): string {
  const parts = [scene.setting, scene.mood, ...((scene.beats ?? []).map((beat) => beat.intent))];
  return parts.filter(Boolean).join(" ");
}

function upsertAnchor(
  anchors: Map<string, VisualAnchorPlanItem>,
  item: VisualAnchorPlanItem
): void {
  const existing = anchors.get(item.id);
  if (!existing) {
    anchors.set(item.id, item);
    return;
  }
  anchors.set(item.id, {
    ...existing,
    sourceSceneIds: [...new Set([...existing.sourceSceneIds, ...item.sourceSceneIds])],
    sourceBeatIds: [...new Set([...existing.sourceBeatIds, ...item.sourceBeatIds])],
  });
}

export function deriveVisualAnchorPlan(plan: EditPlan, feedback?: string): VisualAnchorPlan {
  const anchors = new Map<string, VisualAnchorPlanItem>();

  for (const scene of plan.scenes ?? []) {
    const sceneBeatIds = beatIds(scene);
    for (const characterId of scene.characterIds ?? []) {
      const label = characterId.trim();
      if (!label) continue;
      upsertAnchor(anchors, {
        id: `character_${slug(label)}`,
        kind: "character",
        label,
        description: `Continuity reference for ${label} in ${scene.name}.`,
        sourceSceneIds: [scene.id],
        sourceBeatIds: sceneBeatIds,
      });
    }

    if (scene.setting?.trim()) {
      const setting = scene.setting.trim();
      upsertAnchor(anchors, {
        id: `location_${slug(setting)}`,
        kind: "location",
        label: setting,
        description: sceneSummary(scene) || `Recurring location for ${scene.name}.`,
        sourceSceneIds: [scene.id],
        sourceBeatIds: sceneBeatIds,
      });
    }
  }

  if (anchors.size === 0) {
    anchors.set("style_primary", {
      id: "style_primary",
      kind: "style",
      label: plan.style,
      description: feedback
        ? `${plan.style}. Bias: ${feedback}`
        : `Overall visual style anchor for the ${plan.aspectRatio} video.`,
      sourceSceneIds: (plan.scenes ?? []).map((scene) => scene.id),
      sourceBeatIds: (plan.scenes ?? []).flatMap(beatIds),
    });
  }

  return {
    schemaVersion: "visual_anchor_plan.v1",
    anchors: [...anchors.values()],
  };
}

function planRequired(): ToolCallResult<PlanVisualAnchorsOutput> {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: "plan_visual_anchors needs a shot plan before it can identify anchors.",
      recoverable: true,
      unmetRequirements: [
        {
          requirement: "plan",
          because: "Visual anchors are derived from the planned scenes and beats.",
          satisfyWith: { tool: "plan_shots", inputHint: {} },
        },
      ],
      suggestedNextTools: [{ tool: "plan_shots", inputHint: {} }],
    },
  };
}

export function createPlanVisualAnchorsTool(
  deps: Partial<PlanVisualAnchorsDeps> = {}
): ToolDefinition<PlanVisualAnchorsInput, PlanVisualAnchorsOutput> {
  const resolved = { ...defaultDeps, ...deps };

  return {
    name: "plan_visual_anchors",
    description:
      "Identify reusable character, location, and style anchors from the active shot plan and persist a typed visual-anchor plan. Requires plan_shots first.",
    inputSchema: planVisualAnchorsInputSchema,
    outputSchema: planVisualAnchorsOutputSchema,
    execution: "sync",
    parseInput: parsePlanVisualAnchorsInput,
    estimateCost: () => ({
      estimatedCostUsd: 0,
      unit: "db_write",
      notes: "Anchor planning derives from the persisted shot plan and writes a typed graph asset.",
    }),
    async execute(input, context) {
      if (!context.projectId) {
        return {
          status: "failed",
          error: {
            kind: "precondition_unmet",
            message: "plan_visual_anchors requires a projectId in the execution context.",
            recoverable: false,
          },
        };
      }

      const active = await resolved.getActiveProjectPlan(context.projectId);
      if (!active) return planRequired();

      const visualAnchorPlan = deriveVisualAnchorPlan(active.plan, input.feedback);
      const { visualAnchorPlanAssetId } = await resolved.addProjectVisualAnchorPlan({
        workspaceId: context.auth.workspaceId,
        projectId: context.projectId,
        visualAnchorPlan,
        planAssetId: active.assetId,
        planContentHash: active.contentHash,
      });

      return {
        status: "succeeded",
        resourceIds: [visualAnchorPlanAssetId],
        output: { visualAnchorPlan, visualAnchorPlanAssetId },
      };
    },
  };
}
