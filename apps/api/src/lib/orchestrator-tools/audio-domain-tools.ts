import type { DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";
import type { GraphAssetInput } from "@/lib/api/v1/asset-graph";
import {
  getActiveProjectBrief,
  getActiveProjectPlan,
  getActiveProjectScriptDraft,
  getAsset,
} from "@/lib/api/v1/store";
import {
  loadProjectGraphSnapshot,
  type ProjectGraphSnapshot,
} from "@/lib/orchestrator-context/graph-snapshot";
import {
  assertPreservePinsCurrent,
  assertScopedAssetMint,
  assertScopedPrimitiveInput,
  buildDomainTargetScope,
} from "@/lib/orchestrator-context/target-scope";
import { toolDefinitionMetadata } from "./capability-catalog";
import {
  launchGenerateAudioJob,
  type GenerateAudioDeps,
  type GenerateAudioOutput,
} from "./generate-audio";
import {
  createFitAudioToPictureTool,
  type FitAudioToPictureDeps,
  type FitAudioToPictureInput,
  type FitAudioToPictureOutput,
} from "./fit-audio-to-picture";
import type { AudioContentKind } from "./generate-audio-job";
import type { ToolDefinition, ToolExecutionContext } from "./types";
import { ToolInputError } from "./types";

type AudioTask = Extract<DomainTaskV1, { domain: "audio" }>;
type AudioProvider = "elevenlabs" | "mock";
type AudioMode = "speech" | "dialogue" | "sound_effect" | "music";

export type AudioTarget =
  | { kind: "project"; projectId: string; contentKind: AudioContentKind }
  | { kind: "beat"; beatId: string; contentKind: AudioContentKind }
  | { kind: "asset"; assetId: string; contentKind: AudioContentKind }
  | { kind: "timeline_item"; timelineItemId: string; contentKind: AudioContentKind };

export interface AudioDomainGenerateInput {
  target: AudioTarget;
  prompt?: string;
  spokenText?: string;
  durationSec?: number;
  provider?: AudioProvider;
  voiceId?: string;
  deliveryPreset?: "neutral" | "warm" | "intimate" | "energetic";
  referenceAssetIds: string[];
  feedback?: string;
}

export interface AudioDomainToolDeps extends Partial<GenerateAudioDeps> {
  loadSnapshot: typeof loadProjectGraphSnapshot;
  getPlan: typeof getActiveProjectPlan;
  getBrief: typeof getActiveProjectBrief;
  getScript: typeof getActiveProjectScriptDraft;
  getAsset: typeof getAsset;
}

export interface AudioDomainFitDeps
  extends Partial<FitAudioToPictureDeps> {
  loadSnapshot: typeof loadProjectGraphSnapshot;
}

const defaults: AudioDomainToolDeps = {
  loadSnapshot: loadProjectGraphSnapshot,
  getPlan: getActiveProjectPlan,
  getBrief: getActiveProjectBrief,
  getScript: getActiveProjectScriptDraft,
  getAsset,
};

const id = { type: "string", minLength: 1, maxLength: 128 } as const;

export const audioDomainGenerateInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    target: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["project"] },
            projectId: id,
            contentKind: {
              type: "string",
              enum: ["narration", "dialogue", "music", "sound_effect"],
            },
          },
          required: ["kind", "projectId", "contentKind"],
        },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["beat"] },
            beatId: id,
            contentKind: {
              type: "string",
              enum: ["narration", "dialogue", "music", "sound_effect"],
            },
          },
          required: ["kind", "beatId", "contentKind"],
        },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["asset"] },
            assetId: id,
            contentKind: {
              type: "string",
              enum: ["narration", "dialogue", "music", "sound_effect"],
            },
          },
          required: ["kind", "assetId", "contentKind"],
        },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["timeline_item"] },
            timelineItemId: id,
            contentKind: {
              type: "string",
              enum: ["narration", "dialogue", "music", "sound_effect"],
            },
          },
          required: ["kind", "timelineItemId", "contentKind"],
        },
      ],
    },
    prompt: { type: "string", maxLength: 4_000 },
    spokenText: { type: "string", maxLength: 12_000 },
    durationSec: { type: "number", exclusiveMinimum: 0, maximum: 600 },
    provider: { type: "string", enum: ["elevenlabs", "mock"] },
    voiceId: { type: "string", maxLength: 256 },
    deliveryPreset: {
      type: "string",
      enum: ["neutral", "warm", "intimate", "energetic"],
    },
    referenceAssetIds: { type: "array", maxItems: 32, items: id },
    feedback: { type: "string", maxLength: 2_000 },
  },
  required: ["target"],
} as const;

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolInputError(`generate_audio ${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ToolInputError(`generate_audio ${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) {
    throw new ToolInputError(`generate_audio ${field} must contain at most ${max} characters.`);
  }
  return trimmed;
}

function parseTarget(value: unknown): AudioTarget {
  const target = record(value, "target");
  const kind = target.kind;
  const contentKind = target.contentKind;
  if (
    contentKind !== "narration" &&
    contentKind !== "dialogue" &&
    contentKind !== "music" &&
    contentKind !== "sound_effect"
  ) {
    throw new ToolInputError("generate_audio target.contentKind is invalid.");
  }
  if (kind === "project") {
    const projectId = text(target.projectId, "target.projectId", 128);
    if (!projectId) throw new ToolInputError("generate_audio target.projectId is required.");
    return { kind, projectId, contentKind };
  }
  if (kind === "beat") {
    const beatId = text(target.beatId, "target.beatId", 128);
    if (!beatId) throw new ToolInputError("generate_audio target.beatId is required.");
    return { kind, beatId, contentKind };
  }
  if (kind === "asset") {
    const assetId = text(target.assetId, "target.assetId", 128);
    if (!assetId) throw new ToolInputError("generate_audio target.assetId is required.");
    return { kind, assetId, contentKind };
  }
  if (kind === "timeline_item") {
    const timelineItemId = text(target.timelineItemId, "target.timelineItemId", 128);
    if (!timelineItemId) {
      throw new ToolInputError("generate_audio target.timelineItemId is required.");
    }
    return { kind, timelineItemId, contentKind };
  }
  throw new ToolInputError("generate_audio target.kind is invalid.");
}

export function parseAudioDomainGenerateInput(input: unknown): AudioDomainGenerateInput {
  const value = record(input, "input");
  const allowed = new Set([
    "target",
    "prompt",
    "spokenText",
    "durationSec",
    "provider",
    "voiceId",
    "deliveryPreset",
    "referenceAssetIds",
    "feedback",
  ]);
  const unsupported = Object.keys(value).filter((key) => !allowed.has(key));
  if (unsupported.length) {
    throw new ToolInputError("generate_audio received unsupported fields.", {
      unsupportedFields: unsupported,
    });
  }
  const provider = value.provider;
  if (provider !== undefined && provider !== "elevenlabs" && provider !== "mock") {
    throw new ToolInputError("generate_audio provider must be elevenlabs or mock.");
  }
  const deliveryPreset = value.deliveryPreset;
  if (
    deliveryPreset !== undefined &&
    deliveryPreset !== "neutral" &&
    deliveryPreset !== "warm" &&
    deliveryPreset !== "intimate" &&
    deliveryPreset !== "energetic"
  ) {
    throw new ToolInputError(
      "generate_audio deliveryPreset must be neutral, warm, intimate, or energetic."
    );
  }
  const durationSec =
    value.durationSec === undefined ? undefined : Number(value.durationSec);
  if (
    durationSec !== undefined &&
    (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 600)
  ) {
    throw new ToolInputError("generate_audio durationSec must be between 0 and 600.");
  }
  const references = value.referenceAssetIds;
  if (
    references !== undefined &&
    (!Array.isArray(references) ||
      references.length > 32 ||
      references.some((item) => typeof item !== "string" || !item.trim()))
  ) {
    throw new ToolInputError("generate_audio referenceAssetIds must be stable ids.");
  }
  return {
    target: parseTarget(value.target),
    ...(text(value.prompt, "prompt", 4_000) ? { prompt: text(value.prompt, "prompt", 4_000) } : {}),
    ...(text(value.spokenText, "spokenText", 12_000)
      ? { spokenText: text(value.spokenText, "spokenText", 12_000) }
      : {}),
    ...(durationSec !== undefined ? { durationSec } : {}),
    ...(provider ? { provider } : {}),
    ...(text(value.voiceId, "voiceId", 256) ? { voiceId: text(value.voiceId, "voiceId", 256) } : {}),
    ...(deliveryPreset ? { deliveryPreset } : {}),
    referenceAssetIds: (references ?? []).map((item) => String(item).trim()),
    ...(text(value.feedback, "feedback", 2_000)
      ? { feedback: text(value.feedback, "feedback", 2_000) }
      : {}),
  };
}

function primitiveScopeInput(
  projectId: string,
  input: AudioDomainGenerateInput
): Record<string, unknown> {
  return {
    projectId,
    ...(input.target.kind === "beat" ? { beatId: input.target.beatId } : {}),
    ...(input.target.kind === "asset" ? { assetId: input.target.assetId } : {}),
    ...(input.target.kind === "timeline_item"
      ? { timelineItemId: input.target.timelineItemId }
      : {}),
    assetIds: input.referenceAssetIds,
  };
}

function graphInput(
  snapshot: ProjectGraphSnapshot,
  assetId: string,
  role: string,
  position: number
): GraphAssetInput {
  const asset = snapshot.assets.find((candidate) => candidate.id === assetId);
  if (!asset) throw new ToolInputError(`Audio input asset is not in the project: ${assetId}.`);
  return {
    assetId,
    relation: "input",
    role,
    position,
    ...(asset.contentHash ? { contentHash: asset.contentHash } : {}),
  };
}

function targetBeatDuration(
  input: AudioDomainGenerateInput,
  plan: Awaited<ReturnType<typeof getActiveProjectPlan>>
): number | undefined {
  if (input.target.kind !== "beat" || !plan) return undefined;
  const beatId = input.target.beatId;
  for (const scene of plan.plan.scenes ?? []) {
    const beat = scene.beats?.find((candidate) => candidate.id === beatId);
    if (beat) return beat.durationSec;
  }
  return undefined;
}

function exactScriptText(input: {
  target: AudioTarget;
  script: Awaited<ReturnType<typeof getActiveProjectScriptDraft>>;
  plan: Awaited<ReturnType<typeof getActiveProjectPlan>>;
  snapshot: ProjectGraphSnapshot;
}): { text?: string } {
  if (!input.script) return {};
  const beatId = input.target.kind === "beat" ? input.target.beatId : undefined;
  const scriptScenes =
    beatId
      ? (() => {
          if (!input.plan) return [];
          const planAsset = input.snapshot.assets.find(
            (asset) => asset.id === input.plan?.assetId
          );
          const planUsesCurrentScript = planAsset?.inputs.some(
            (dependency) =>
              dependency.assetId === input.script?.assetId &&
              dependency.role === "script_draft"
          );
          if (!planUsesCurrentScript) return [];

          const plannedSceneIndex = input.plan.plan.scenes.findIndex((scene) =>
            scene.beats?.some((beat) => beat.id === beatId)
          );
          if (plannedSceneIndex < 0) return [];
          const plannedScene = input.plan.plan.scenes[plannedSceneIndex];
          const exactIdMatch = input.script.scriptDraft.scenes.find(
            (scene) => scene.id === plannedScene.id
          );
          const normalizedName = plannedScene.name.trim().toLocaleLowerCase();
          const titleMatches = normalizedName
            ? input.script.scriptDraft.scenes.filter(
                (scene) => scene.title.trim().toLocaleLowerCase() === normalizedName
              )
            : [];
          const scriptScene =
            exactIdMatch ??
            (titleMatches.length === 1 ? titleMatches[0] : undefined);
          return scriptScene ? [scriptScene] : [];
        })()
      : input.target.kind === "project"
        ? input.script.scriptDraft.scenes
        : [];
  if (input.target.contentKind === "dialogue") {
    const dialogue = scriptScenes.flatMap((scene) => scene.dialogue);
    return {
      text: dialogue.map((line) => line.text).join("\n").trim() || undefined,
    };
  }
  if (input.target.contentKind === "narration") {
    return {
      text:
        (input.target.kind === "project"
          ? input.script.scriptDraft.narration?.trim()
          : undefined) ||
        scriptScenes
          .map((scene) => scene.narration?.trim())
          .filter(Boolean)
          .join(" "),
    };
  }
  return {};
}

function explicitlyAuthorizedAsset(task: AudioTask, assetId: string): boolean {
  return (
    task.targets.some(
      (target) => target.kind === "asset" && target.assetId === assetId
    ) ||
    task.preserve.assetIds.includes(assetId) ||
    task.preserve.fingerprints.some((pin) => pin.assetId === assetId) ||
    task.preserve.selections.some((pin) => pin.activeAssetId === assetId) ||
    task.preserve.pins.some((pin) => pin.kind === "asset" && pin.id === assetId)
  );
}

function explicitlyAuthorizedBeat(task: AudioTask, beatId: string): boolean {
  return task.targets.some(
    (target) => target.kind === "beat" && target.beatId === beatId
  );
}

function exactScriptSegmentRequired() {
  return {
    status: "failed" as const,
    error: {
      kind: "precondition_unmet" as const,
      message:
        "The targeted beat does not map to one exact current script segment.",
      recoverable: true,
      unmetRequirements: [
        {
          requirement: "exact_script_segment",
          because:
            "Audio cannot speak unrelated scenes or infer approved words from free-form intent.",
          satisfyWith: {
            tool: "draft_script" as const,
            inputHint: {},
          },
        },
      ],
      suggestedNextTools: [{ tool: "draft_script" as const, inputHint: {} }],
    },
  };
}

function modeFor(kind: AudioContentKind): AudioMode {
  if (kind === "narration") return "speech";
  if (kind === "dialogue") return "dialogue";
  return kind;
}

function revisionContentKindMatchesSource(
  sourceAsset: NonNullable<Awaited<ReturnType<typeof getAsset>>>,
  contentKind: AudioContentKind
): boolean {
  const recordedMode = sourceAsset.provenance?.providerSettings?.audioMode;
  const trustedModes: AudioMode[] = [];
  if (
    recordedMode === "speech" ||
    recordedMode === "dialogue" ||
    recordedMode === "sound_effect" ||
    recordedMode === "music"
  ) {
    trustedModes.push(recordedMode);
  }
  const roleMode: Record<string, AudioMode> = {
    voiceover: "speech",
    dialogue: "dialogue",
    sound_effect: "sound_effect",
    soundtrack: "music",
  };
  const trustedRoleMode = sourceAsset.role
    ? roleMode[sourceAsset.role]
    : undefined;
  if (trustedRoleMode) trustedModes.push(trustedRoleMode);
  const requestedMode = modeFor(contentKind);
  return (
    trustedModes.length > 0 &&
    trustedModes.every((trustedMode) => trustedMode === requestedMode)
  );
}

function roleFor(kind: AudioContentKind, taskKind: AudioTask["taskKind"]): string {
  if (taskKind === "soundtrack_create" || kind === "music") return "soundtrack";
  if (kind === "narration") return "voiceover";
  if (kind === "dialogue") return "dialogue";
  return "sound_effect";
}

function displayName(role: string): string {
  if (role === "soundtrack") return "Soundtrack";
  if (role === "voiceover") return "Voiceover";
  if (role === "dialogue") return "Dialogue";
  return "Sound effect";
}

function voiceSettingsForDelivery(
  preset: AudioDomainGenerateInput["deliveryPreset"]
) {
  if (preset === "warm") {
    return {
      stability: 0.35,
      similarityBoost: 0.75,
      style: 0.35,
      speed: 0.95,
      useSpeakerBoost: true,
    };
  }
  if (preset === "intimate") {
    return {
      stability: 0.45,
      similarityBoost: 0.8,
      style: 0.2,
      speed: 0.92,
      useSpeakerBoost: true,
    };
  }
  if (preset === "energetic") {
    return {
      stability: 0.3,
      similarityBoost: 0.7,
      style: 0.45,
      speed: 1.05,
      useSpeakerBoost: true,
    };
  }
  return undefined;
}

function missingPlan() {
  return {
    status: "failed" as const,
    error: {
      kind: "precondition_unmet" as const,
      message: "Targeted production audio requires the current shot plan.",
      recoverable: true,
      unmetRequirements: [
        {
          requirement: "plan",
          because: "The requested beat and duration must come from the current plan.",
          satisfyWith: { tool: "plan_shots" as const, inputHint: {} },
        },
      ],
      suggestedNextTools: [{ tool: "plan_shots" as const, inputHint: {} }],
    },
  };
}

export function createAudioDomainGenerateTool(
  task: AudioTask,
  deps: Partial<AudioDomainToolDeps> = {}
): ToolDefinition<AudioDomainGenerateInput, GenerateAudioOutput> {
  const d = { ...defaults, ...deps };
  return {
    ...toolDefinitionMetadata("generate_audio"),
    description:
      `Create one bounded ${task.taskKind} audio outcome. The target and immutable inputs must match the trusted task. ` +
      "Use exact script/spoken words; prompt and feedback may change only delivery, voice, warmth, mix, or sound design. Standalone output stays pooled and unselected.",
    usage: {
      preconditions: [
        "The target is an exact project, beat, asset, or timeline-item id from the trusted task.",
        "Narration/dialogue uses exact current script text; meaning changes require a question.",
      ],
      produces: ["One immutable audio_track with typed graph inputs and provider metadata."],
      useWhen: [
        "Generating narration, dialogue, music, sound effects, or a standalone soundtrack.",
        "Retrying delivery or mix while preserving spoken meaning.",
      ],
    },
    inputSchema: audioDomainGenerateInputSchema,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        jobId: { type: "string" },
        assetIds: { type: "array", items: { type: "string" } },
      },
    },
    parseInput: parseAudioDomainGenerateInput,
    estimateCost: () => ({
      estimatedCostUsd: 0,
      unit: "audio_generation",
      notes: "The generated-assets provider call records and settles the actual cost.",
    }),
    async execute(input, context) {
      if (!context.projectId) {
        return {
          status: "failed",
          error: {
            kind: "precondition_unmet",
            message: "generate_audio requires a projectId.",
            recoverable: false,
          },
        };
      }
      if (task.taskKind === "audio_fit") {
        throw new ToolInputError(
          "audio_fit assignments must use fit_audio_to_picture."
        );
      }
      if (
        task.taskKind === "soundtrack_create" &&
        input.target.contentKind !== "music"
      ) {
        throw new ToolInputError(
          "soundtrack_create may generate only a music soundtrack."
        );
      }
      if (task.taskKind === "audio_revision" && input.target.kind !== "asset") {
        throw new ToolInputError(
          "audio_revision requires an exact source asset target."
        );
      }
      if (
        task.taskKind === "audio_revision" &&
        input.target.kind === "asset" &&
        !explicitlyAuthorizedAsset(task, input.target.assetId)
      ) {
        throw new ToolInputError(
          "audio_revision source must be an explicit trusted asset target or pin."
        );
      }
      const snapshot = await d.loadSnapshot({
        workspaceId: context.auth.workspaceId,
        projectId: context.projectId,
      });
      const scope = buildDomainTargetScope({
        snapshot,
        targets: task.targets,
        candidateAffectedAssetIds: task.candidateAffectedAssetIds,
      });
      assertPreservePinsCurrent(scope, snapshot, task.preserve);
      assertScopedPrimitiveInput(scope, primitiveScopeInput(context.projectId, input));

      const sourceAssetId =
        task.taskKind === "audio_revision" && input.target.kind === "asset"
          ? input.target.assetId
          : undefined;
      const sourceAsset = sourceAssetId
        ? await d.getAsset(
            context.auth.workspaceId,
            context.projectId,
            sourceAssetId
          )
        : null;
      if (
        sourceAsset &&
        (sourceAsset.kind !== "audio" || sourceAsset.status !== "ready")
      ) {
        throw new ToolInputError(
          "audio_revision source must be a ready audio_track."
        );
      }
      if (
        sourceAsset &&
        !revisionContentKindMatchesSource(
          sourceAsset,
          input.target.contentKind
        )
      ) {
        throw new ToolInputError(
          "audio_revision cannot change the trusted source audio subtype."
        );
      }
      const graphInputs: GraphAssetInput[] = input.referenceAssetIds.map((assetId, index) =>
        graphInput(snapshot, assetId, "reference", index)
      );
      if (sourceAssetId && !graphInputs.some((candidate) => candidate.assetId === sourceAssetId)) {
        graphInputs.push(graphInput(snapshot, sourceAssetId, "source", graphInputs.length));
      }

      const needsPlan = task.taskKind === "audio_production";
      const [plan, brief, script] = await Promise.all([
        needsPlan ? d.getPlan(context.projectId) : Promise.resolve(null),
        task.taskKind === "audio_production"
          ? d.getBrief(context.projectId)
          : Promise.resolve(null),
        task.taskKind === "audio_production" &&
        (input.target.contentKind === "narration" ||
          input.target.contentKind === "dialogue")
          ? d.getScript(context.projectId)
          : Promise.resolve(null),
      ]);
      if (needsPlan && !plan) return missingPlan();

      for (const dependency of [
        plan
          ? { assetId: plan.assetId, role: "plan" }
          : null,
        brief
          ? { assetId: brief.assetId, role: "brief" }
          : null,
      ]) {
        if (
          dependency &&
          !graphInputs.some((candidate) => candidate.assetId === dependency.assetId)
        ) {
          if (!scope.authorizedAssetIds.has(dependency.assetId)) {
            throw new ToolInputError(
              `The current ${dependency.role} asset is outside the trusted Audio task.`
            );
          }
          graphInputs.push(
            graphInput(
              snapshot,
              dependency.assetId,
              dependency.role,
              graphInputs.length
            )
          );
        }
      }
      if (script) {
        if (!scope.authorizedAssetIds.has(script.assetId)) {
          throw new ToolInputError("The current script asset is outside the trusted Audio task.");
        }
        if (!graphInputs.some((candidate) => candidate.assetId === script.assetId)) {
          graphInputs.push(graphInput(snapshot, script.assetId, "script", graphInputs.length));
        }
      }
      assertScopedAssetMint(
        scope,
        {
          outputKind: "audio_track",
          inputAssetIds: graphInputs.map((candidate) => candidate.assetId),
        },
        task.allowedOutputKinds
      );

      if (
        task.taskKind === "audio_create" &&
        (input.target.contentKind === "narration" ||
          input.target.contentKind === "dialogue")
      ) {
        return {
          status: "failed",
          error: {
            kind: "precondition_unmet",
            message:
              "Standalone narration or dialogue requires immutable script-backed spoken text; request a creative decision instead of supplying model-authored words.",
            recoverable: true,
          },
        };
      }

      const scripted = exactScriptText({
        target: input.target,
        script,
        plan,
        snapshot,
      });
      if (
        script &&
        input.target.kind === "beat" &&
        (input.target.contentKind === "narration" ||
          input.target.contentKind === "dialogue") &&
        !scripted.text
      ) {
        return exactScriptSegmentRequired();
      }
      const sourceSpokenText =
        sourceAsset &&
        (input.target.contentKind === "narration" ||
          input.target.contentKind === "dialogue")
          ? sourceAsset.provenance?.prompt?.trim() ||
            sourceAsset.context?.transcriptText?.trim() ||
            sourceAsset.semanticAnalysis?.transcript
              ?.map((span) => span.text)
              .join("\n")
              .trim()
          : undefined;
      const spokenText =
        sourceSpokenText ||
        scripted.text ||
        (task.taskKind === "audio_revision" ? undefined : input.spokenText);
      if (
        (input.target.contentKind === "narration" ||
          input.target.contentKind === "dialogue") &&
        !spokenText
      ) {
        throw new ToolInputError(
          "Narration/dialogue generation requires exact trusted spoken text."
        );
      }
      const role = roleFor(input.target.contentKind, task.taskKind);
      const direction = [input.prompt, input.feedback, brief?.brief.style]
        .filter(Boolean)
        .join(" ");
      const prompt =
        input.target.contentKind === "narration" || input.target.contentKind === "dialogue"
          ? spokenText!
          : input.prompt ?? task.instruction;
      const durationSec =
        input.durationSec ??
        targetBeatDuration(input, plan) ??
        (task.taskKind === "audio_production"
          ? plan?.plan.targetLengthSec
          : undefined) ??
        (task.taskKind === "soundtrack_create" ? 30 : 8);
      return launchGenerateAudioJob({
        context,
        deps: d,
        jobInput: {
          mode: "single_track",
          taskKind: task.taskKind,
          ...(input.provider ? { provider: input.provider } : {}),
          ...(input.voiceId ? { voiceId: input.voiceId } : {}),
          ...(direction ? { feedback: direction } : {}),
          graphInputs,
          singleTrack: {
            prompt,
            description: direction || task.objective,
            displayName: displayName(role),
            durationSec,
            audioMode: modeFor(input.target.contentKind),
            assetRole: role,
            ...(voiceSettingsForDelivery(input.deliveryPreset)
              ? {
                  voiceSettings: voiceSettingsForDelivery(
                    input.deliveryPreset
                  ),
                }
              : {}),
            ...(input.target.contentKind === "dialogue" && input.voiceId
              ? {
                  dialogueInputs: scripted.text
                    ?.split("\n")
                    .filter(Boolean)
                    .map((text) => ({ text, voiceId: input.voiceId! })),
                }
              : {}),
            ...(role === "soundtrack" ? { forceInstrumental: true } : {}),
            ...(sourceAssetId ? { sourceAssetId } : {}),
          },
        },
      });
    },
  };
}

export function createAudioDomainFitTool(
  task: AudioTask,
  deps: Partial<AudioDomainFitDeps> = {}
): ToolDefinition<FitAudioToPictureInput, FitAudioToPictureOutput> {
  const base = createFitAudioToPictureTool(deps);
  const loadSnapshot = deps.loadSnapshot ?? loadProjectGraphSnapshot;
  return {
    ...base,
    description:
      "Fit an exact authorized audio track to a current authorized picture asset and beat window. " +
      "The persisted critique keeps audio, picture, and plan graph inputs. Missing picture is a cross-domain prerequisite; excessive mismatch requires a question unless exact-word delivery can be retried.",
    usage: {
      preconditions: [
        "audioAssetId and pictureAssetId are exact assets in the trusted task scope.",
        "pictureAssetId is a ready video with measured duration, and beatId is current.",
      ],
      produces: [
        "A typed audio_fit critique with audio, picture, and plan provenance; it does not falsely mint a replacement audio track.",
      ],
      useWhen: [
        "Checking or refitting narration/dialogue delivery against current picture.",
      ],
    },
    inputSchema: {
      ...base.inputSchema,
    },
    parseInput(input) {
      if (input && typeof input === "object" && !Array.isArray(input)) {
        const options = (input as { options?: unknown }).options;
        if (options && typeof options === "object" && !Array.isArray(options)) {
          if (
            "targetWindow" in options ||
            "words" in options
          ) {
            throw new ToolInputError(
              "Audio-domain fit timing must come from current server-owned picture/audio metadata."
            );
          }
        }
      }
      return base.parseInput(input);
    },
    async execute(input, context) {
      if (!context.projectId) {
        return {
          status: "failed",
          error: {
            kind: "precondition_unmet",
            message: "fit_audio_to_picture requires a projectId.",
            recoverable: false,
          },
        };
      }
      if (!input.pictureAssetId) {
        return {
          status: "failed",
          error: {
            kind: "precondition_unmet",
            message: "Current picture media is required before audio can be fit.",
            recoverable: true,
            unmetRequirements: [
              {
                requirement: "current_picture",
                because:
                  "Audio timing must be measured against the current clip rather than a fabricated plan window.",
                satisfyWith: {
                  tool: "generate_clip",
                  inputHint: { beatId: input.beatId },
                },
              },
            ],
            suggestedNextTools: [
              { tool: "generate_clip", inputHint: { beatId: input.beatId } },
            ],
          },
        };
      }
      if (input.options?.targetWindow || input.options?.words) {
        throw new ToolInputError(
          "Audio-domain fit timing must come from current server-owned picture/audio metadata."
        );
      }
      if (
        !explicitlyAuthorizedAsset(task, input.audioAssetId) ||
        !explicitlyAuthorizedAsset(task, input.pictureAssetId) ||
        !explicitlyAuthorizedBeat(task, input.beatId)
      ) {
        throw new ToolInputError(
          "audio_fit requires explicit trusted audio, picture, and beat targets or asset pins."
        );
      }
      const snapshot = await loadSnapshot({
        workspaceId: context.auth.workspaceId,
        projectId: context.projectId,
      });
      const scope = buildDomainTargetScope({
        snapshot,
        targets: task.targets,
        candidateAffectedAssetIds: task.candidateAffectedAssetIds,
      });
      assertPreservePinsCurrent(scope, snapshot, task.preserve);
      assertScopedPrimitiveInput(scope, {
        projectId: context.projectId,
        beatId: input.beatId,
        assetIds: [input.audioAssetId, input.pictureAssetId],
      });
      return base.execute(input, context);
    },
  };
}

export function targetIdsForAudioInput(input: AudioDomainGenerateInput): string[] {
  return [
    ...(input.target.kind === "asset" ? [input.target.assetId] : []),
    ...input.referenceAssetIds,
  ];
}

export function audioTaskForRegistry(task: DomainTaskV1): AudioTask {
  if (task.domain !== "audio") throw new Error("Audio registry requires an Audio task.");
  return task as AudioTask;
}

export function audioContextProject(context: ToolExecutionContext): string {
  if (!context.projectId) throw new ToolInputError("Audio tool requires a project.");
  return context.projectId;
}
