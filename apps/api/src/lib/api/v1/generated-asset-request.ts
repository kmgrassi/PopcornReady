import { parseConsistencyMode } from "@/lib/generative/character-context";
import {
  AudioGenerationMode,
  AudioVoiceSettings,
  DialogueInput,
  GenerativeAssetKind,
  GenerativeProviderName,
  IdeogramMagicPrompt,
  IdeogramRenderingSpeed,
  IdeogramStyleType,
} from "@popcorn/shared/generative/types";
import type { AssetInputRelation, GraphAssetInput } from "./asset-graph";
import { FieldError, validationError } from "./errors";

const AUDIO_MODES = new Set(["speech", "dialogue", "sound_effect", "music"]);

// provider -> supported kinds for the agent endpoint.
export const PROVIDER_KIND_SUPPORT: Record<
  GenerativeProviderName,
  GenerativeAssetKind[]
> = {
  openai: ["image", "video"],
  ideogram: ["image"],
  gemini: ["image", "video"],
  runway: ["video"],
  ltx: ["video"],
  kling: ["video"],
  seedance: ["video"],
  xai: ["image", "video"],
  nvidia_api_catalog: ["video"],
  elevenlabs: ["audio"],
  mock: ["image", "video", "audio"],
  nanobanano: [],
};

export interface ParsedRequest {
  kind: GenerativeAssetKind;
  provider: GenerativeProviderName;
  providerWasExplicit: boolean;
  prompt: string;
  description: string;
  durationSec: number;
  providerSeconds?: number;
  referenceAssetIds: string[];
  editSourceAssetId?: string;
  /** Immutable image/audio revision source; new bytes mint version+1 in this lineage. */
  sourceAssetId?: string;
  beatId?: string;
  anchorIds: string[];
  characterProfileIds: string[];
  characterReferenceIds: string[];
  consistencyMode: ReturnType<typeof parseConsistencyMode>;
  preflightIterations: number;
  audioMode?: AudioGenerationMode;
  dialogueInputs?: DialogueInput[];
  model?: string;
  size?: string;
  quality?: "low" | "medium" | "high" | "auto";
  aspectRatio?: string;
  renderingSpeed?: IdeogramRenderingSpeed;
  magicPrompt?: IdeogramMagicPrompt;
  numImages?: number;
  styleType?: IdeogramStyleType;
  stylePreset?: string;
  customModelUri?: string;
  enableCopyrightDetection?: boolean;
  voiceId?: string;
  voiceSettings?: AudioVoiceSettings;
  outputFormat?: string;
  languageCode?: string;
  loop?: boolean;
  promptInfluence?: number;
  forceInstrumental?: boolean;
  seed?: number;
  frameCount?: number;
  fps?: number;
  steps?: number;
  guidanceScale?: number;
  negativePrompt?: string;
  resolution?: string;
  runId?: string;
  assetRole?: string;
  displayName?: string;
  // Stable, project-scoped handle the generating agent assigned to this asset.
  slug?: string;
  graphInputs?: GraphAssetInput[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function parseAssetInputRelation(value: unknown): AssetInputRelation {
  return value === "anchor" || value === "child" || value === "input" ? value : "input";
}

function parseGraphInputs(value: unknown): GraphAssetInput[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const inputs: GraphAssetInput[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!isPlainObject(item) || typeof item.assetId !== "string") continue;
    inputs.push({
      assetId: item.assetId,
      relation: parseAssetInputRelation(item.relation),
      ...(typeof item.role === "string" ? { role: item.role } : {}),
      position: typeof item.position === "number" ? item.position : index,
      ...(typeof item.contentHash === "string" ? { contentHash: item.contentHash } : {}),
    });
  }
  return inputs;
}

function normalizeProvider(
  value: unknown,
  kind: GenerativeAssetKind
): GenerativeProviderName | null {
  const fallback =
    kind === "audio" ? "elevenlabs" : kind === "video" ? "gemini" : "openai";
  const name = String(value || fallback).toLowerCase();
  if (name === "openai") return "openai";
  if (name === "ideogram") return "ideogram";
  if (name === "gemini") return "gemini";
  if (name === "runway" || name === "runwayml") return "runway";
  if (name === "ltx" || name === "ltxvideo" || name === "ltx-video") return "ltx";
  if (name === "kling" || name === "klingai" || name === "kling-ai") return "kling";
  if (
    name === "seedance" ||
    name === "seedance2" ||
    name === "seedance-2" ||
    name === "seedance-2.0"
  ) {
    return "seedance";
  }
  if (name === "xai" || name === "grok" || name === "grok-imagine") return "xai";
  if (
    name === "nvidia" ||
    name === "nvidia_api_catalog" ||
    name === "nvidia-api-catalog" ||
    name === "cosmos" ||
    name === "cosmos3" ||
    name === "cosmos3-nano"
  ) {
    return "nvidia_api_catalog";
  }
  if (name === "elevenlabs") return "elevenlabs";
  if (name === "mock") return "mock";
  if (name === "nanobanano" || name === "nano-banano" || name === "nano_banano") {
    return "nanobanano";
  }
  return null;
}

function parseAudioMode(value: unknown): AudioGenerationMode | undefined {
  const mode = String(value || "");
  return AUDIO_MODES.has(mode) ? (mode as AudioGenerationMode) : undefined;
}

function parseQuality(value: unknown): ParsedRequest["quality"] {
  const q = String(value || "");
  return q === "low" || q === "medium" || q === "high" || q === "auto"
    ? q
    : undefined;
}

function parseIdeogramRenderingSpeed(value: unknown): IdeogramRenderingSpeed | undefined {
  const speed = String(value || "").toUpperCase();
  return speed === "FLASH" ||
    speed === "TURBO" ||
    speed === "DEFAULT" ||
    speed === "QUALITY"
    ? speed
    : undefined;
}

function parseIdeogramMagicPrompt(value: unknown): IdeogramMagicPrompt | undefined {
  const magicPrompt = String(value || "").toUpperCase();
  return magicPrompt === "AUTO" || magicPrompt === "ON" || magicPrompt === "OFF"
    ? magicPrompt
    : undefined;
}

function parseIdeogramStyleType(value: unknown): IdeogramStyleType | undefined {
  const styleType = String(value || "").toUpperCase();
  return styleType === "AUTO" ||
    styleType === "GENERAL" ||
    styleType === "REALISTIC" ||
    styleType === "DESIGN" ||
    styleType === "FICTION"
    ? styleType
    : undefined;
}

function parseNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseAudioVoiceSettings(
  value: unknown,
  kind: GenerativeAssetKind
): AudioVoiceSettings | undefined {
  if (value === undefined) return undefined;
  if (kind !== "audio" || !isPlainObject(value)) {
    throw validationError("The request body is invalid.", [
      {
        path: "voiceSettings",
        message: "Voice settings are supported only for audio and must be an object.",
      },
    ]);
  }
  const allowed = new Set([
    "stability",
    "similarityBoost",
    "style",
    "speed",
    "useSpeakerBoost",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw validationError("The request body is invalid.", [
      { path: "voiceSettings", message: "Contains unsupported voice settings." },
    ]);
  }
  const settings: AudioVoiceSettings = {};
  for (const key of ["stability", "similarityBoost", "style"] as const) {
    if (value[key] === undefined) continue;
    const number = Number(value[key]);
    if (!Number.isFinite(number) || number < 0 || number > 1) {
      throw validationError("The request body is invalid.", [
        { path: `voiceSettings.${key}`, message: "Must be between 0 and 1." },
      ]);
    }
    settings[key] = number;
  }
  if (value.speed !== undefined) {
    const speed = Number(value.speed);
    if (!Number.isFinite(speed) || speed < 0.7 || speed > 1.2) {
      throw validationError("The request body is invalid.", [
        { path: "voiceSettings.speed", message: "Must be between 0.7 and 1.2." },
      ]);
    }
    settings.speed = speed;
  }
  if (value.useSpeakerBoost !== undefined) {
    if (typeof value.useSpeakerBoost !== "boolean") {
      throw validationError("The request body is invalid.", [
        {
          path: "voiceSettings.useSpeakerBoost",
          message: "Must be a boolean.",
        },
      ]);
    }
    settings.useSpeakerBoost = value.useSpeakerBoost;
  }
  return settings;
}

export function parseGeneratedAssetRequest(body: unknown): ParsedRequest {
  if (!isPlainObject(body)) {
    throw validationError("The request body is invalid.", [
      { path: "", message: "Must be an object." },
    ]);
  }
  const fields: FieldError[] = [];

  const kind = String(body.kind ?? "image") as GenerativeAssetKind;
  if (kind !== "image" && kind !== "video" && kind !== "audio") {
    throw validationError("The request body is invalid.", [
      { path: "kind", message: "Must be one of: image, video, audio." },
    ]);
  }

  const providerWasExplicit =
    typeof body.provider === "string" && body.provider.trim().length > 0;
  const provider = normalizeProvider(body.provider, kind);
  if (!provider) {
    throw validationError("The request body is invalid.", [
      { path: "provider", message: `Unknown provider: ${String(body.provider)}.` },
    ]);
  }

  const supportedKinds = PROVIDER_KIND_SUPPORT[provider];
  if (!supportedKinds.includes(kind)) {
    const reason = supportedKinds.length
      ? `Provider "${provider}" supports ${supportedKinds.join(
          ", "
        )} generation, not ${kind}.`
      : `Provider "${provider}" is registered but not implemented yet.`;
    throw validationError("The request body is invalid.", [
      { path: "provider", message: reason },
    ]);
  }

  const audioMode = parseAudioMode(body.audioMode);
  const dialogueInputs: DialogueInput[] | undefined = Array.isArray(
    body.dialogueInputs
  )
    ? (body.dialogueInputs as unknown[]).map((line) => {
        const entry = isPlainObject(line) ? line : {};
        return {
          text: String(entry.text || ""),
          voiceId: String(entry.voiceId || entry.voice_id || ""),
        };
      })
    : undefined;
  const hasDialogueText =
    kind === "audio" &&
    audioMode === "dialogue" &&
    Boolean(dialogueInputs?.some((line) => line.text.trim()));

  const prompt = String(body.prompt || "").trim();
  if (!prompt && !hasDialogueText) {
    throw validationError("The request body is invalid.", [
      { path: "prompt", message: "prompt is required unless dialogueInputs are provided." },
    ]);
  }

  const dialogueText = dialogueInputs
    ?.map((line) => line.text)
    .filter(Boolean)
    .join(" ");
  const description = String(body.description || prompt || dialogueText || "");

  const seconds =
    body.seconds !== undefined ? Number(body.seconds) : undefined;
  const durationSec =
    Number(body.durationSec) || (kind === "image" ? 4 : seconds || 8);

  const characterProfileIds = parseStringArray(body.characterProfileIds);
  let consistencyMode: ReturnType<typeof parseConsistencyMode>;
  try {
    consistencyMode =
      body.consistencyMode !== undefined
        ? parseConsistencyMode(body.consistencyMode)
        : parseConsistencyMode(
            characterProfileIds.length > 0 ? "reference_pack" : "prompt_only"
          );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Invalid consistencyMode.";
    fields.push({ path: "consistencyMode", message });
    throw validationError("The request body is invalid.", fields);
  }

  const preflightIterations =
    body.preflightReviewIterations === undefined
      ? 0
      : Number(body.preflightReviewIterations);

  return {
    kind,
    provider,
    providerWasExplicit,
    prompt,
    description,
    durationSec,
    providerSeconds: kind === "image" ? undefined : durationSec,
    referenceAssetIds: parseStringArray(body.referenceAssetIds),
    editSourceAssetId:
      typeof body.editSourceAssetId === "string" && body.editSourceAssetId.trim()
        ? body.editSourceAssetId.trim()
        : undefined,
    sourceAssetId:
      (kind === "image" || kind === "audio") &&
      typeof body.sourceAssetId === "string" &&
      body.sourceAssetId.trim()
        ? body.sourceAssetId.trim()
        : undefined,
    beatId:
      typeof body.beatId === "string" && body.beatId.trim()
        ? body.beatId.trim()
        : undefined,
    anchorIds: parseStringArray(body.anchorIds),
    characterProfileIds,
    characterReferenceIds: parseStringArray(body.characterReferenceIds),
    consistencyMode,
    preflightIterations,
    audioMode,
    dialogueInputs,
    model: body.model ? String(body.model) : undefined,
    size: body.size ? String(body.size) : undefined,
    quality: parseQuality(body.quality),
    aspectRatio: body.aspectRatio ? String(body.aspectRatio) : undefined,
    renderingSpeed: parseIdeogramRenderingSpeed(
      body.renderingSpeed ?? body.rendering_speed
    ),
    magicPrompt: parseIdeogramMagicPrompt(body.magicPrompt ?? body.magic_prompt),
    numImages: parseNumber(body.numImages ?? body.num_images),
    styleType: parseIdeogramStyleType(body.styleType ?? body.style_type),
    stylePreset: body.stylePreset
      ? String(body.stylePreset)
      : body.style_preset
        ? String(body.style_preset)
        : undefined,
    customModelUri: body.customModelUri
      ? String(body.customModelUri)
      : body.custom_model_uri
        ? String(body.custom_model_uri)
        : undefined,
    enableCopyrightDetection:
      typeof body.enableCopyrightDetection === "boolean"
        ? body.enableCopyrightDetection
        : typeof body.enable_copyright_detection === "boolean"
          ? body.enable_copyright_detection
          : undefined,
    voiceId: body.voiceId ? String(body.voiceId) : undefined,
    voiceSettings: parseAudioVoiceSettings(body.voiceSettings, kind),
    outputFormat: body.outputFormat ? String(body.outputFormat) : undefined,
    languageCode: body.languageCode ? String(body.languageCode) : undefined,
    loop: typeof body.loop === "boolean" ? body.loop : undefined,
    promptInfluence:
      typeof body.promptInfluence === "number" ? body.promptInfluence : undefined,
    forceInstrumental:
      typeof body.forceInstrumental === "boolean"
        ? body.forceInstrumental
        : undefined,
    seed: parseNumber(body.seed),
    frameCount: parseNumber(body.frameCount),
    fps: parseNumber(body.fps),
    steps: parseNumber(body.steps),
    guidanceScale: parseNumber(body.guidanceScale),
    negativePrompt: body.negativePrompt
      ? String(body.negativePrompt)
      : undefined,
    resolution: body.resolution ? String(body.resolution) : undefined,
    runId: body.runId ? String(body.runId) : undefined,
    assetRole: body.assetRole ? String(body.assetRole) : undefined,
    displayName:
      typeof body.displayName === "string"
        ? body.displayName
        : typeof body.title === "string"
          ? body.title
          : typeof body.name === "string"
            ? body.name
            : undefined,
    slug: typeof body.slug === "string" ? body.slug : undefined,
    graphInputs: parseGraphInputs(body.graphInputs),
  };
}
