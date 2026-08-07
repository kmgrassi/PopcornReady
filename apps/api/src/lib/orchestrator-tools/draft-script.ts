import {
  addProjectScriptDraft as realAddProjectScriptDraft,
  getActiveProjectScriptDraft as realGetActiveProjectScriptDraft,
  getActiveProjectBrief as realGetActiveProjectBrief,
  getActiveProjectStoryBlueprint as realGetActiveProjectStoryBlueprint,
  type ActiveProjectBrief,
  type ActiveProjectStoryBlueprint,
  type StoryBlueprint,
  type StoryBlueprintAct,
  type StoryBlueprintCharacter,
} from "@/lib/api/v1/store";
import type {
  ScriptDraft,
  ScriptDialogueLine,
  ScriptScene,
  StoryDurationClass,
  StoryDurationPlan,
} from "@popcorn/shared/types";
import {
  buildFootageGroundingContext,
  groundingGraphInputs,
  type FootageGroundingContext,
} from "./footage-grounding";
import { selectedUploadedFootageAssetIds } from "@/lib/orchestrator/uploaded-footage-selection";
import { toolDefinitionMetadata } from "./capability-catalog";
import type { ToolCallResult, ToolDefinition } from "./types";
import { ToolInputError } from "./types";

export interface DraftScriptInput {
  feedback?: string;
  revisedScript?: string;
  authoredScript?: {
    narration?: string;
    scenes: Array<{
      title: string;
      summary: string;
      narration?: string;
      dialogue?: ScriptDialogueLine[];
      visualIntent?: string;
      durationSec?: number;
    }>;
  };
}

export interface DraftScriptOutput {
  scriptDraft: ScriptDraft;
  scriptDraftId: string;
  scriptDraftAssetId: string;
}

export interface DraftScriptDeps {
  getActiveProjectBrief: typeof realGetActiveProjectBrief;
  getActiveProjectStoryBlueprint: typeof realGetActiveProjectStoryBlueprint;
  addProjectScriptDraft: typeof realAddProjectScriptDraft;
  getActiveProjectScriptDraft: typeof realGetActiveProjectScriptDraft;
  buildFootageGroundingContext: typeof buildFootageGroundingContext;
}

const defaultDeps: DraftScriptDeps = {
  getActiveProjectBrief: realGetActiveProjectBrief,
  getActiveProjectStoryBlueprint: realGetActiveProjectStoryBlueprint,
  addProjectScriptDraft: realAddProjectScriptDraft,
  getActiveProjectScriptDraft: realGetActiveProjectScriptDraft,
  buildFootageGroundingContext,
};

const str = { type: "string" } as const;

const dialogueLineSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    characterId: str,
    characterName: str,
    text: str,
    delivery: str,
  },
  required: ["text"],
} as const;

const authoredScriptSceneSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: str,
    summary: str,
    narration: str,
    dialogue: { type: "array", items: dialogueLineSchema, minItems: 1 },
    visualIntent: str,
    durationSec: { type: "number" },
  },
  required: ["title", "summary"],
  anyOf: [{ required: ["narration"] }, { required: ["dialogue"] }],
} as const;

const scriptSceneSchema = {
  ...authoredScriptSceneSchema,
  properties: { id: str, ...authoredScriptSceneSchema.properties },
  required: ["id", "title", "summary", "dialogue"],
} as const;

export const draftScriptInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    feedback: {
      type: "string",
      description: "Optional instruction for revising narration, dialogue, or scene emphasis.",
    },
    revisionInstruction: {
      type: "string",
      description: "Alias used by approval-rejection retries.",
    },
    revisedScript: {
      type: "string",
      description: "Complete revised script text that incorporates the requested changes.",
    },
    authoredScript: {
      type: "object",
      additionalProperties: false,
      properties: {
        narration: str,
        scenes: { type: "array", items: authoredScriptSceneSchema },
      },
      required: ["scenes"],
    },
  },
  required: [],
} as const;

export const draftScriptOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    scriptDraft: {
      type: "object",
      additionalProperties: false,
      properties: {
        schemaVersion: { type: "string", enum: ["scriptDraft.v1"] },
        id: str,
        projectId: str,
        briefAssetId: str,
        storyBlueprintId: str,
        targetLengthSec: { type: "number" },
        durationClass: {
          type: "string",
          enum: ["micro", "short", "medium", "long", "feature"],
        },
        durationPlan: { type: "object", additionalProperties: true },
        scenes: { type: "array", items: scriptSceneSchema },
        narration: str,
        createdAt: str,
        updatedAt: str,
        supersedesId: str,
        status: { type: "string", enum: ["draft", "approved", "archived"] },
      },
      required: [
        "schemaVersion",
        "id",
        "projectId",
        "briefAssetId",
        "storyBlueprintId",
        "targetLengthSec",
        "durationClass",
        "durationPlan",
        "scenes",
        "createdAt",
        "updatedAt",
        "status",
      ],
    },
    scriptDraftId: str,
    scriptDraftAssetId: str,
  },
  required: ["scriptDraft", "scriptDraftId", "scriptDraftAssetId"],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

export function parseDraftScriptInput(input: unknown): DraftScriptInput {
  if (input === undefined || input === null) return {};
  if (!isRecord(input)) {
    throw new ToolInputError("draft_script input must be an object.", {
      expected: draftScriptInputSchema,
    });
  }
  const allowed = new Set(["feedback", "revisionInstruction", "revisedScript", "authoredScript"]);
  const extra = Object.keys(input).filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    throw new ToolInputError("draft_script received unsupported fields.", {
      unsupportedFields: extra,
    });
  }
  const feedback = input.feedback;
  if (feedback !== undefined && typeof feedback !== "string") {
    throw new ToolInputError("draft_script feedback must be a string.", {});
  }
  const revisionInstruction = input.revisionInstruction;
  if (revisionInstruction !== undefined && typeof revisionInstruction !== "string") {
    throw new ToolInputError("draft_script revisionInstruction must be a string.", {});
  }
  const revisedScript = input.revisedScript;
  if (revisedScript !== undefined && typeof revisedScript !== "string") {
    throw new ToolInputError("draft_script revisedScript must be a string.", {});
  }
  let authoredScript: DraftScriptInput["authoredScript"];
  if (input.authoredScript !== undefined) {
    if (!isRecord(input.authoredScript) ||
      !hasOnlyKeys(input.authoredScript, ["narration", "scenes"]) ||
      (input.authoredScript.narration !== undefined && typeof input.authoredScript.narration !== "string") ||
      !Array.isArray(input.authoredScript.scenes)) {
      throw new ToolInputError("draft_script authoredScript must contain scenes.", {});
    }
    const scenes = input.authoredScript.scenes;
    if (scenes.length === 0 || scenes.some((scene) =>
      !isRecord(scene) || !hasOnlyKeys(scene, ["title", "summary", "narration", "dialogue", "visualIntent", "durationSec"]) ||
      !nonEmptyString(scene.title) || !nonEmptyString(scene.summary) ||
      (scene.narration !== undefined && typeof scene.narration !== "string") ||
      (scene.visualIntent !== undefined && typeof scene.visualIntent !== "string") ||
      (scene.durationSec !== undefined && (typeof scene.durationSec !== "number" || !Number.isFinite(scene.durationSec) || scene.durationSec <= 0)) ||
      (scene.dialogue !== undefined && (!Array.isArray(scene.dialogue) || scene.dialogue.some((line) =>
        !isRecord(line) || !hasOnlyKeys(line, ["characterId", "characterName", "text", "delivery"]) ||
        !nonEmptyString(line.text) ||
        (line.characterId !== undefined && !nonEmptyString(line.characterId)) ||
        (line.characterName !== undefined && !nonEmptyString(line.characterName)) ||
        (line.delivery !== undefined && !nonEmptyString(line.delivery))
      ))) ||
      (!nonEmptyString(scene.narration) && (!Array.isArray(scene.dialogue) || scene.dialogue.length === 0))
    )) {
      throw new ToolInputError("draft_script authoredScript scenes are incomplete.", {});
    }
    authoredScript = input.authoredScript as DraftScriptInput["authoredScript"];
  }
  const instruction = feedback ?? revisionInstruction;
  return {
    ...(instruction && instruction.trim() ? { feedback: instruction.trim() } : {}),
    ...(revisedScript && revisedScript.trim() ? { revisedScript: revisedScript.trim() } : {}),
    ...(authoredScript ? { authoredScript } : {}),
  };
}

function briefRequired(): ToolCallResult<DraftScriptOutput> {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: "draft_script needs a project brief before it can write a script.",
      recoverable: true,
      unmetRequirements: [
        {
          requirement: "brief",
          because: "The script inherits the video's goal, target length, and style.",
          satisfyWith: { tool: "create_or_load_brief", inputHint: {} },
        },
      ],
      suggestedNextTools: [{ tool: "create_or_load_brief", inputHint: {} }],
    },
  };
}

function blueprintRequired(): ToolCallResult<DraftScriptOutput> {
  return {
    status: "failed",
    error: {
      kind: "precondition_unmet",
      message: "draft_script needs a story blueprint before it can write scene-level copy.",
      recoverable: true,
      unmetRequirements: [
        {
          requirement: "story_blueprint",
          because: "The script expands the approved premise, arc, characters, acts, and ending.",
          satisfyWith: { tool: "develop_story_blueprint", inputHint: {} },
        },
      ],
      suggestedNextTools: [{ tool: "develop_story_blueprint", inputHint: {} }],
    },
  };
}

function classifyStoryDuration(targetLengthSec: number): StoryDurationClass {
  if (targetLengthSec <= 30) return "micro";
  if (targetLengthSec <= 90) return "short";
  if (targetLengthSec <= 300) return "medium";
  if (targetLengthSec <= 1800) return "long";
  return "feature";
}

function storyDurationPlan(targetLengthSec: number): StoryDurationPlan {
  const durationClass = classifyStoryDuration(targetLengthSec);
  const expectedActCount =
    durationClass === "micro" || durationClass === "short"
      ? 1
      : durationClass === "medium"
        ? 3
        : durationClass === "long"
          ? 5
          : 8;
  const expectedSceneCount =
    durationClass === "micro"
      ? 1
      : durationClass === "short"
        ? 3
        : durationClass === "medium"
          ? 8
          : durationClass === "long"
            ? 24
            : 60;
  const expectedBeatCount = Math.max(expectedSceneCount, Math.round(targetLengthSec / 8));
  const planningGranularity =
    durationClass === "micro"
      ? "beats_only"
      : durationClass === "short"
        ? "scenes_and_beats"
        : durationClass === "medium"
          ? "acts_scenes_beats"
          : "sequences_acts_scenes_beats";
  return {
    targetLengthSec,
    durationClass,
    expectedActCount,
    expectedSceneCount,
    expectedBeatCount,
    planningGranularity,
  };
}

function characterLine(
  character: StoryBlueprintCharacter,
  act: StoryBlueprintAct,
  index: number
): ScriptDialogueLine {
  const lead = character.description
    ? `${character.description} ${act.title} changes everything.`
    : `This is where ${act.title.toLowerCase()} changes everything.`;
  return {
    characterId: character.id,
    characterName: character.name,
    text: index === 0 ? lead : `${act.summary} We need to move now.`,
    ...(character.role ? { delivery: character.role } : {}),
  };
}

function sceneDuration(targetLengthSec: number, count: number): number {
  if (count <= 0) return targetLengthSec;
  return Math.max(1, Math.round(targetLengthSec / count));
}

function fallbackAct(blueprint: StoryBlueprint): StoryBlueprintAct {
  return {
    id: "act_1",
    title: "Story",
    summary: blueprint.logline || blueprint.premise,
    purpose: blueprint.ending,
    targetDurationSec: blueprint.targetLengthSec,
  };
}

function groundingNarrationParts(
  grounding?: FootageGroundingContext | null
): { narration: string[]; dialogue: ScriptDialogueLine[] } {
  if (!grounding || grounding.excerpts.length === 0) return { narration: [], dialogue: [] };
  const narration = grounding.excerpts.flatMap((excerpt) => {
    const parts: string[] = [];
    if (excerpt.transcript) parts.push(`From the original audio: "${excerpt.transcript}"`);
    for (const moment of excerpt.moments.slice(0, 2)) {
      parts.push(
        `At ${moment.startSec.toFixed(1)}-${moment.endSec.toFixed(1)}s, ${moment.label}${moment.description ? `: ${moment.description}` : ""}.`
      );
    }
    return parts;
  });
  const firstTranscript = grounding.excerpts.find((excerpt) => excerpt.transcript)?.transcript;
  return {
    narration,
    dialogue: firstTranscript
      ? [
          {
            text: firstTranscript,
            delivery: "quote from uploaded footage transcript",
          },
        ]
      : [],
  };
}

export function draftScriptFromState(input: {
  brief: ActiveProjectBrief;
  blueprint: ActiveProjectStoryBlueprint;
  feedback?: string;
  revisedScript?: string;
  authoredScript?: DraftScriptInput["authoredScript"];
  footageGrounding?: FootageGroundingContext | null;
}): Omit<
  ScriptDraft,
  "id" | "projectId" | "briefAssetId" | "storyBlueprintId" | "createdAt" | "updatedAt"
> {
  const story = input.blueprint.storyBlueprint;
  const durationPlan = storyDurationPlan(story.targetLengthSec || input.brief.brief.targetLengthSec);
  const acts = story.acts.length > 0 ? story.acts : [fallbackAct(story)];
  const characters = story.characters.slice(0, 2);
  const perSceneDuration = sceneDuration(story.targetLengthSec, acts.length);
  const grounding = groundingNarrationParts(input.footageGrounding);
  const providedScript = input.revisedScript ??
    (input.brief.brief.narration?.mode === "provided_text"
      ? input.brief.brief.narration.script?.trim()
      : undefined);

  const scenes: ScriptScene[] = input.authoredScript
    ? input.authoredScript.scenes.map((scene, index) => ({
        id: `script_scene_${index + 1}`,
        title: scene.title.trim(),
        summary: scene.summary.trim(),
        ...(scene.narration?.trim() ? { narration: scene.narration.trim() } : {}),
        dialogue: scene.dialogue ?? [],
        ...(scene.visualIntent?.trim() ? { visualIntent: scene.visualIntent.trim() } : {}),
        durationSec: scene.durationSec ?? sceneDuration(story.targetLengthSec, input.authoredScript!.scenes.length),
      }))
    : acts.map((act, index) => {
    const narrationParts = providedScript
      ? [
          index === 0 ? providedScript : undefined,
        ].filter(Boolean)
      : [
          act.summary,
          act.purpose,
          index === 0 ? grounding.narration.join(" ") : undefined,
          index === acts.length - 1 ? story.ending : undefined,
          input.feedback ? `Revision note: ${input.feedback}` : undefined,
        ].filter(Boolean);
    return {
      id: `script_scene_${index + 1}`,
      title: act.title,
      summary: act.summary,
      narration: narrationParts.join(" "),
      dialogue: providedScript
        ? []
        : index === 0 && grounding.dialogue.length > 0
          ? grounding.dialogue
          : characters.map((character, characterIndex) =>
              characterLine(character, act, characterIndex)
            ),
      visualIntent: `${story.tone ?? input.brief.brief.style ?? "cinematic"} scene for ${act.title}.`,
      durationSec: perSceneDuration,
    };
      });

  const narration = input.authoredScript?.narration?.trim() || (providedScript
    ? providedScript
    : [
        story.logline ?? story.premise,
        ...scenes.map((scene) => scene.narration).filter(Boolean),
        story.ending,
      ].join("\n\n"));

  return {
    schemaVersion: "scriptDraft.v1",
    targetLengthSec: story.targetLengthSec,
    durationClass: durationPlan.durationClass,
    durationPlan,
    scenes,
    narration,
    status: "draft",
  };
}

export function createDraftScriptTool(
  deps: Partial<DraftScriptDeps> = {}
): ToolDefinition<DraftScriptInput, DraftScriptOutput> {
  const resolved = { ...defaultDeps, ...deps };

  return {
    ...toolDefinitionMetadata("draft_script"),
    description:
      "Draft scene-level narration and dialogue from the active brief and story blueprint, then persist it as the active script draft.",
    usage: {
      preconditions: [
        "An active project brief exists (call create_or_load_brief first).",
        "An active story blueprint exists (call develop_story_blueprint first).",
      ],
      produces: [
        "A relational script_drafts row and an immutable narration_script asset with provenance to the brief and story blueprint.",
      ],
      useWhen: [
        "The story blueprint is ready and the project needs scene-level dialogue or narration before shot planning or audio generation.",
        "A script-stage review was rejected: rewrite the complete script from the feedback and pass it as revisedScript.",
      ],
    },
    inputSchema: draftScriptInputSchema,
    outputSchema: draftScriptOutputSchema,
    parseInput: parseDraftScriptInput,
    estimateCost: () => ({
      estimatedCostUsd: 0,
      unit: "model_call",
      notes: "Drafting is text-only and does not spend media budget.",
    }),
    async execute(input, context) {
      if (!context.projectId) {
        return {
          status: "failed",
          error: {
            kind: "precondition_unmet",
            message: "draft_script requires a projectId in the execution context.",
            recoverable: false,
          },
        };
      }
      if (input.feedback && !input.revisedScript && !input.authoredScript) {
        return {
          status: "failed",
          error: {
            kind: "invalid_input",
            message: "A script revision requires the complete rewritten script in revisedScript.",
            recoverable: true,
            suggestedNextTools: [
              { tool: "draft_script", inputHint: { revisedScript: "Complete rewritten script" } },
            ],
          },
        };
      }

      const brief = await resolved.getActiveProjectBrief(context.projectId);
      if (!brief) return briefRequired();

      const blueprint = await resolved.getActiveProjectStoryBlueprint(context.projectId);
      if (!blueprint) return blueprintRequired();
      const footageGrounding = await resolved.buildFootageGroundingContext({
        workspaceId: context.auth.workspaceId,
        projectId: context.projectId,
        assetIds: selectedUploadedFootageAssetIds(context.metadata),
      });
      const predecessor = await resolved.getActiveProjectScriptDraft(context.projectId);

      const scriptDraft = draftScriptFromState({
        brief,
        blueprint,
        feedback: input.feedback,
        revisedScript: input.revisedScript,
        authoredScript: input.authoredScript,
        footageGrounding,
      });
      const persisted = await resolved.addProjectScriptDraft({
        workspaceId: context.auth.workspaceId,
        projectId: context.projectId,
        scriptDraft,
        briefAssetId: brief.assetId,
        briefContentHash: brief.contentHash,
        storyBlueprintId: blueprint.storyBlueprintId,
        storyBlueprintAssetId: blueprint.assetId,
        storyBlueprintContentHash: blueprint.contentHash,
        groundingInputs: groundingGraphInputs(footageGrounding, 2),
        ...(predecessor ? { supersedesId: predecessor.scriptDraftId } : {}),
      });

      const output: ScriptDraft = {
        ...scriptDraft,
        id: persisted.scriptDraftId,
        projectId: context.projectId,
        briefAssetId: brief.assetId,
        storyBlueprintId: blueprint.storyBlueprintId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return {
        status: "succeeded",
        resourceIds: [persisted.scriptDraftId, persisted.scriptDraftAssetId],
        artifactIds: [persisted.scriptDraftAssetId],
        output: {
          scriptDraft: output,
          scriptDraftId: persisted.scriptDraftId,
          scriptDraftAssetId: persisted.scriptDraftAssetId,
        },
      };
    },
  };
}
