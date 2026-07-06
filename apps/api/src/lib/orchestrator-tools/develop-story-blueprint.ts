import {
  addProjectStoryBlueprint as realAddProjectStoryBlueprint,
  getActiveProjectBrief as realGetActiveProjectBrief,
  type StoryBlueprint,
} from "@/lib/api/v1/store";
import type { VideoBrief } from "@/lib/api/v1/schemas";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";

export interface DevelopStoryBlueprintInput {
  feedback?: string;
}

export interface DevelopStoryBlueprintOutput {
  storyBlueprint: StoryBlueprint;
  storyBlueprintId: string;
  storyBlueprintAssetId: string;
}

export interface DevelopStoryBlueprintDeps {
  getActiveProjectBrief: typeof realGetActiveProjectBrief;
  addProjectStoryBlueprint: typeof realAddProjectStoryBlueprint;
}

const defaultDeps: DevelopStoryBlueprintDeps = {
  getActiveProjectBrief: realGetActiveProjectBrief,
  addProjectStoryBlueprint: realAddProjectStoryBlueprint,
};

const str = { type: "string" } as const;
const num = { type: "number" } as const;

const storyBlueprintActSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: str,
    title: str,
    purpose: str,
    summary: str,
    targetDurationSec: num,
  },
  required: ["id", "title", "purpose", "summary", "targetDurationSec"],
} as const;

const storyBlueprintSceneSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: str,
    title: str,
    summary: str,
    actId: str,
    targetDurationSec: num,
  },
  required: ["id", "title", "summary", "actId", "targetDurationSec"],
} as const;

const storyBlueprintCharacterSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: str,
    name: str,
    role: str,
    description: str,
  },
  required: ["id", "name", "role", "description"],
} as const;

export const storyBlueprintSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "string", enum: ["storyBlueprint.v1"] },
    premise: str,
    logline: str,
    tone: str,
    audience: str,
    targetLengthSec: num,
    aspectRatio: { type: "string", enum: ["9:16", "16:9", "1:1"] },
    characters: { type: "array", items: storyBlueprintCharacterSchema },
    acts: { type: "array", items: storyBlueprintActSchema },
    scenes: { type: "array", items: storyBlueprintSceneSchema },
    ending: str,
  },
  required: [
    "schemaVersion",
    "premise",
    "logline",
    "tone",
    "targetLengthSec",
    "aspectRatio",
    "characters",
    "acts",
    "scenes",
    "ending",
  ],
} as const;

export const developStoryBlueprintInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    feedback: {
      type: "string",
      description: "Optional instruction for revising the current story direction.",
    },
    revisionInstruction: {
      type: "string",
      description: "Alias used by approval-rejection retries.",
    },
  },
  required: [],
} as const;

export const developStoryBlueprintOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    storyBlueprint: storyBlueprintSchema,
    storyBlueprintId: str,
    storyBlueprintAssetId: str,
  },
  required: ["storyBlueprint", "storyBlueprintId", "storyBlueprintAssetId"],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseDevelopStoryBlueprintInput(
  input: unknown
): DevelopStoryBlueprintInput {
  if (input === undefined || input === null) return {};
  if (!isRecord(input)) {
    throw new ToolInputError("develop_story_blueprint input must be an object.", {
      expected: developStoryBlueprintInputSchema,
    });
  }
  const allowed = new Set(["feedback", "revisionInstruction"]);
  const extra = Object.keys(input).filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    throw new ToolInputError("develop_story_blueprint received unsupported fields.", {
      unsupportedFields: extra,
    });
  }
  const feedback = input.feedback;
  if (feedback !== undefined && typeof feedback !== "string") {
    throw new ToolInputError("develop_story_blueprint feedback must be a string.", {});
  }
  const revisionInstruction = input.revisionInstruction;
  if (revisionInstruction !== undefined && typeof revisionInstruction !== "string") {
    throw new ToolInputError(
      "develop_story_blueprint revisionInstruction must be a string.",
      {}
    );
  }
  const instruction = feedback ?? revisionInstruction;
  return instruction && instruction.trim() ? { feedback: instruction.trim() } : {};
}

function sentence(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function slug(value: string): string {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "story";
}

function splitDurations(total: number): [number, number, number] {
  const setup = Math.round(total * 0.25 * 100) / 100;
  const escalation = Math.round(total * 0.5 * 100) / 100;
  const payoff = Math.round((total - setup - escalation) * 100) / 100;
  return [setup, escalation, payoff];
}

export function deriveStoryBlueprint(
  brief: VideoBrief,
  feedback?: string
): StoryBlueprint {
  const targetLengthSec = brief.targetLengthSec;
  const [setupSec, escalationSec, payoffSec] = splitDurations(targetLengthSec);
  const tone = brief.style?.trim() || "clear, cinematic";
  const premise = sentence(brief.goal);
  const feedbackNote = feedback ? ` Revision direction: ${sentence(feedback)}` : "";

  return {
    schemaVersion: "storyBlueprint.v1",
    premise,
    logline: `${premise} The piece builds from a fast setup into a focused payoff for a ${targetLengthSec}-second ${brief.aspectRatio} video.${feedbackNote}`,
    tone,
    targetLengthSec,
    aspectRatio: brief.aspectRatio,
    characters: [
      {
        id: `subject_${slug(brief.goal).slice(0, 40)}`,
        name: "Primary subject",
        role: "hero",
        description: `The main visible subject that carries the story: ${premise}`,
      },
    ],
    acts: [
      {
        id: "act_1_setup",
        title: "Setup",
        purpose: "Orient the viewer and establish why the story matters.",
        summary: `Open with the clearest visual expression of: ${premise}`,
        targetDurationSec: setupSec,
      },
      {
        id: "act_2_escalation",
        title: "Escalation",
        purpose: "Develop the idea with concrete visual progression.",
        summary: `Show the subject taking action in the requested ${tone} style.`,
        targetDurationSec: escalationSec,
      },
      {
        id: "act_3_payoff",
        title: "Payoff",
        purpose: "Land the memorable final beat.",
        summary: "Resolve with a concise image or moment that makes the premise stick.",
        targetDurationSec: payoffSec,
      },
    ],
    scenes: [
      {
        id: "scene_1_setup",
        title: "Opening setup",
        summary: `Introduce the situation: ${premise}`,
        actId: "act_1_setup",
        targetDurationSec: setupSec,
      },
      {
        id: "scene_2_progression",
        title: "Story progression",
        summary: `Build momentum with visual details that support the ${tone} tone.`,
        actId: "act_2_escalation",
        targetDurationSec: escalationSec,
      },
      {
        id: "scene_3_payoff",
        title: "Final payoff",
        summary: "Finish with a strong final image and clear emotional resolution.",
        actId: "act_3_payoff",
        targetDurationSec: payoffSec,
      },
    ],
    ending: "A clean, memorable final beat that reinforces the brief's goal.",
  };
}

// Shared by the orchestrator tool and the direct HTTP regenerate endpoint so
// both paths derive and persist the blueprint identically. Returns null when
// the project has no active brief (the caller decides how to surface that).
export async function developStoryBlueprintForProject(
  input: { workspaceId: string; projectId: string; feedback?: string },
  deps: Partial<DevelopStoryBlueprintDeps> = {}
): Promise<DevelopStoryBlueprintOutput | null> {
  const resolved = { ...defaultDeps, ...deps };
  const active = await resolved.getActiveProjectBrief(input.projectId);
  if (!active) return null;

  const storyBlueprint = deriveStoryBlueprint(active.brief, input.feedback);
  const persisted = await resolved.addProjectStoryBlueprint({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    blueprint: storyBlueprint,
    briefAssetId: active.assetId,
    briefContentHash: active.contentHash,
  });

  return {
    storyBlueprint,
    storyBlueprintId: persisted.storyBlueprintId,
    storyBlueprintAssetId: persisted.storyBlueprintAssetId,
  };
}

function briefRequired(): ToolCallResult<DevelopStoryBlueprintOutput> {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: "develop_story_blueprint needs a project brief before it can write a blueprint.",
      recoverable: true,
      unmetRequirements: [
        {
          requirement: "brief",
          because: "The story blueprint derives its premise, tone, duration, and format from the brief.",
          satisfyWith: { tool: "create_or_load_brief", inputHint: {} },
        },
      ],
      suggestedNextTools: [{ tool: "create_or_load_brief", inputHint: {} }],
    },
  };
}

export function createDevelopStoryBlueprintTool(
  deps: Partial<DevelopStoryBlueprintDeps> = {}
): ToolDefinition<DevelopStoryBlueprintInput, DevelopStoryBlueprintOutput> {
  return {
    name: "develop_story_blueprint",
    description:
      "Develop a structured story blueprint from the active project brief and persist it as the current canonical story resource. Requires a brief first.",
    usage: {
      preconditions: ["An active project brief exists (call create_or_load_brief first)."],
      produces: [
        "A canonical story_blueprints row plus an immutable story_blueprint asset with graph provenance to the brief.",
      ],
      useWhen: [
        "The project needs longer-form story structure before script or shot planning.",
        "A story-level approval was rejected and the premise, arc, or ending needs revision.",
      ],
    },
    inputSchema: developStoryBlueprintInputSchema,
    outputSchema: developStoryBlueprintOutputSchema,
    execution: "sync",
    parseInput: parseDevelopStoryBlueprintInput,
    estimateCost: () => ({
      estimatedCostUsd: 0,
      unit: "db_write",
      notes: "The first wired implementation deterministically derives the blueprint from the persisted brief.",
    }),
    async execute(input, context) {
      if (!context.projectId) {
        return {
          status: "failed",
          error: {
            kind: "precondition_unmet",
            message: "develop_story_blueprint requires a projectId in the execution context.",
            recoverable: false,
          },
        };
      }

      const output = await developStoryBlueprintForProject(
        {
          workspaceId: context.auth.workspaceId,
          projectId: context.projectId,
          feedback: input.feedback,
        },
        deps
      );
      if (!output) return briefRequired();

      return {
        status: "succeeded",
        resourceIds: [output.storyBlueprintId, output.storyBlueprintAssetId],
        output,
      };
    },
  };
}
