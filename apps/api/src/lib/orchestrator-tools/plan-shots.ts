import { planEdit as realPlanEdit } from "@/lib/agent";
import type { VideoBrief } from "@/lib/api/v1/schemas";
import {
  addProjectPlan as realAddProjectPlan,
  getActiveProjectBrief as realGetActiveProjectBrief,
  getActiveProjectScriptDraft as realGetActiveProjectScriptDraft,
  getActiveProjectStoryBlueprint as realGetActiveProjectStoryBlueprint,
} from "@/lib/api/v1/store";
import { withLlmCostRecording } from "@/lib/api/v1/llm-costs";
import { briefToStoryContext } from "@/lib/v1/generation/prepare";
import type { ShotPlan } from "@popcorn/shared/types";
import { buildFootageGroundingContext, groundingGraphInputs } from "./footage-grounding";
import { selectedUploadedFootageAssetIds } from "@/lib/orchestrator/uploaded-footage-selection";
import { toolDefinitionMetadata } from "./capability-catalog";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";

// plan_shots derives the shot plan from the project's persisted brief. This live
// stage contract is intentionally named ShotPlan so it can move onto relational
// story beats without carrying the legacy EditPlan vocabulary forward.
export interface PlanShotsInput {
  /** Optional instruction to revise an existing plan. */
  feedback?: string;
}

export interface PlanShotsOutput {
  plan: ShotPlan;
  planAssetId: string;
}

export interface PlanShotsDeps {
  planEdit: typeof realPlanEdit;
  getActiveProjectBrief: typeof realGetActiveProjectBrief;
  getActiveProjectStoryBlueprint: typeof realGetActiveProjectStoryBlueprint;
  getActiveProjectScriptDraft: typeof realGetActiveProjectScriptDraft;
  addProjectPlan: typeof realAddProjectPlan;
  buildFootageGroundingContext: typeof buildFootageGroundingContext;
}

const defaultDeps: PlanShotsDeps = {
  planEdit: realPlanEdit,
  getActiveProjectBrief: realGetActiveProjectBrief,
  getActiveProjectStoryBlueprint: realGetActiveProjectStoryBlueprint,
  getActiveProjectScriptDraft: realGetActiveProjectScriptDraft,
  addProjectPlan: realAddProjectPlan,
  buildFootageGroundingContext,
};

const DEFAULT_STYLE = "fast-paced social ad";

function narrativeContext(input: {
  storyBlueprint: Awaited<ReturnType<typeof realGetActiveProjectStoryBlueprint>>;
  scriptDraft: Awaited<ReturnType<typeof realGetActiveProjectScriptDraft>>;
}): string | null {
  const blueprint = input.storyBlueprint;
  if (!blueprint) return null;
  const script =
    input.scriptDraft?.scriptDraft.storyBlueprintId === blueprint.storyBlueprintId
      ? input.scriptDraft.scriptDraft
      : null;
  const lines = [
    `Premise: ${blueprint.storyBlueprint.premise}`,
    `Logline: ${blueprint.storyBlueprint.logline}`,
    `Ending: ${blueprint.storyBlueprint.ending}`,
    "Acts:",
    ...blueprint.storyBlueprint.acts.map((act) => `- ${act.title}: ${act.purpose}. ${act.summary}`),
    "Story scenes:",
    ...blueprint.storyBlueprint.scenes.map((scene) => `- ${scene.title}: ${scene.summary}`),
  ];
  if (script) {
    lines.push(
      "Narration and dialogue:",
      ...script.scenes.map((scene) => {
        const spoken = [
          scene.narration,
          ...scene.dialogue.map((line) =>
            line.characterName ? `${line.characterName}: ${line.text}` : line.text
          ),
        ]
          .filter((text): text is string => Boolean(text?.trim()))
          .join(" ");
        return `- ${scene.title}: ${spoken}`.trim();
      })
    );
  }
  return lines.join("\n");
}

const num = { type: "number" } as const;
const str = { type: "string" } as const;

const persistedBeatSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: str,
    name: str,
    durationSec: num,
    intent: str,
    sourceWindow: {
      type: "object",
      additionalProperties: false,
      properties: {
        assetId: str,
        startSec: num,
        endSec: num,
        label: str,
      },
      required: ["startSec", "endSec"],
    },
  },
  required: ["id", "name", "durationSec", "intent"],
};

const persistedSceneSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: str,
    name: str,
    setting: str,
    mood: str,
    characterIds: { type: "array", items: str },
    anchorAssetId: str,
    beats: { type: "array", items: persistedBeatSchema },
  },
  required: ["id", "name", "beats"],
};

export const persistedShotPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    targetLengthSec: num,
    style: str,
    aspectRatio: { type: "string", enum: ["9:16", "16:9", "1:1"] },
    scenes: {
      type: "array",
      items: persistedSceneSchema,
    },
  },
  required: ["targetLengthSec", "style", "aspectRatio", "scenes"],
};

// The plan's creative inputs come from the brief, so the model supplies almost
// nothing here. Permissive on extra fields the model may pass out of habit; only
// `feedback` is read.
export const planShotsInputSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    feedback: {
      type: "string",
      description: "Optional instruction to revise an existing plan.",
    },
  },
  required: [],
};

export const planShotsOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    plan: persistedShotPlanSchema,
    planAssetId: str,
  },
  required: ["plan", "planAssetId"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parsePlanShotsInput(input: unknown): PlanShotsInput {
  if (input === undefined || input === null) return {};
  if (!isRecord(input)) {
    throw new ToolInputError("plan_shots input must be an object.", {
      expected: planShotsInputSchema,
    });
  }
  const feedback = input.feedback;
  if (feedback !== undefined && typeof feedback !== "string") {
    throw new ToolInputError("plan_shots feedback must be a string.", {});
  }
  return feedback && feedback.trim() ? { feedback: feedback.trim() } : {};
}

function briefRequired(): ToolCallResult<PlanShotsOutput> {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: "plan_shots needs a project brief before it can plan shots.",
      recoverable: true,
      unmetRequirements: [
        {
          requirement: "brief",
          because:
            "The plan is derived from the project's brief (goal, length, aspect ratio, style).",
          satisfyWith: { tool: "create_or_load_brief", inputHint: {} },
        },
      ],
      suggestedNextTools: [{ tool: "create_or_load_brief", inputHint: {} }],
    },
  };
}

export function createPlanShotsTool(
  deps: Partial<PlanShotsDeps> = {}
): ToolDefinition<PlanShotsInput, PlanShotsOutput> {
  const resolved = { ...defaultDeps, ...deps };

  return {
    ...toolDefinitionMetadata("plan_shots"),
    description:
      "Plan ordered scenes and beats from the project's brief, incorporating the active story blueprint and matching script when present, and persist them as the active plan. Requires a brief first.",
    usage: {
      preconditions: ["An active project brief exists (call create_or_load_brief first)."],
      produces: ["An ordered list of scenes and beats with stable ids, persisted as the active plan and linked to any narrative assets used."],
      useWhen: [
        "The brief is ready and the story needs to be broken into concrete scenes and beats.",
        "A plan-stage review was rejected and the scenes/beats need revising (pass feedback).",
      ],
    },
    inputSchema: planShotsInputSchema,
    outputSchema: planShotsOutputSchema,
    parseInput: parsePlanShotsInput,
    estimateCost: () => ({
      estimatedCostUsd: 0,
      unit: "model_call",
      notes: "Planning is a cheap structured agent call and does not spend media budget.",
    }),
    async execute(input, context) {
      if (!context.projectId) {
        return {
          status: "failed",
          error: {
            kind: "precondition_unmet",
            message: "plan_shots requires a projectId in the execution context.",
            recoverable: false,
          },
        };
      }

      const active = await resolved.getActiveProjectBrief(context.projectId);
      if (!active) {
        return briefRequired();
      }
      const { brief } = active;
      const [storyBlueprint, scriptDraft, footageGrounding] = await Promise.all([
        resolved.getActiveProjectStoryBlueprint(context.projectId),
        resolved.getActiveProjectScriptDraft(context.projectId),
        resolved.buildFootageGroundingContext({
          workspaceId: context.auth.workspaceId,
          projectId: context.projectId,
          assetIds: selectedUploadedFootageAssetIds(context.metadata),
        }),
      ]);
      const matchingScript =
        scriptDraft?.scriptDraft.storyBlueprintId === storyBlueprint?.storyBlueprintId
          ? scriptDraft
          : null;
      const narrativeInputs = Number(Boolean(storyBlueprint)) + Number(Boolean(matchingScript));

      const plan = await withLlmCostRecording(
        {
          projectId: context.projectId,
          runId: context.orchestratorRunId,
          ...(context.actionId ? { actionId: context.actionId } : {}),
        },
        () =>
          resolved.planEdit({
            goal: brief.goal,
            targetLengthSec: brief.targetLengthSec,
            style: brief.style ?? DEFAULT_STYLE,
            aspectRatio: brief.aspectRatio,
            storyContext: briefToStoryContext(brief),
            narrativeContext: narrativeContext({ storyBlueprint, scriptDraft: matchingScript }),
            feedback: input.feedback ?? null,
            footageGrounding: footageGrounding.promptText,
          })
      );

      // Record the brief as the plan's input so a brief replacement marks the
      // plan (and its downstream) stale.
      const { planAssetId } = await resolved.addProjectPlan({
        workspaceId: context.auth.workspaceId,
        projectId: context.projectId,
        plan,
        briefAssetId: active.assetId,
        briefContentHash: active.contentHash,
        ...(storyBlueprint
          ? {
              storyBlueprintAssetId: storyBlueprint.assetId,
              storyBlueprintContentHash: storyBlueprint.contentHash,
            }
          : {}),
        ...(matchingScript
          ? {
              scriptDraftAssetId: matchingScript.assetId,
              scriptDraftContentHash: matchingScript.contentHash,
            }
          : {}),
        groundingInputs: groundingGraphInputs(footageGrounding, 1 + narrativeInputs),
      });

      return {
        status: "succeeded",
        resourceIds: [planAssetId],
        output: { plan, planAssetId },
      };
    },
  };
}
