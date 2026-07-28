import type {
  AudioGenerationMode,
  DialogueInput,
} from "@popcorn/shared/generative/types";
import { stripSpeechDirectives } from "@/lib/generative/audio";
import type { V1Asset } from "./store-types";

const ROLE_MODE: Record<string, AudioGenerationMode> = {
  voiceover: "speech",
  dialogue: "dialogue",
  sound_effect: "sound_effect",
  soundtrack: "music",
};

function isAudioMode(value: unknown): value is AudioGenerationMode {
  return (
    value === "speech" ||
    value === "dialogue" ||
    value === "sound_effect" ||
    value === "music"
  );
}

function normalizedWords(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized || undefined;
}

export function providerEffectiveAudioRevisionText(input: {
  mode?: AudioGenerationMode;
  prompt: string;
  dialogueInputs?: DialogueInput[];
}): string | undefined {
  if (input.mode === "speech") {
    return normalizedWords(stripSpeechDirectives(input.prompt));
  }
  if (input.mode !== "dialogue") return undefined;
  const dialogueText = input.dialogueInputs
    ?.filter((line) => line.text.trim() && line.voiceId.trim())
    .map((line) => line.text)
    .join("\n");
  return normalizedWords(dialogueText || input.prompt);
}

export function trustedAudioRevisionText(
  source: Pick<V1Asset, "provenance" | "context" | "semanticAnalysis">
): string | undefined {
  return (
    normalizedWords(source.provenance?.providerPrompt) ??
    normalizedWords(source.provenance?.prompt) ??
    normalizedWords(source.context?.transcriptText) ??
    normalizedWords(
      source.semanticAnalysis?.transcript
        ?.map((span) => span.text)
        .join("\n")
    )
  );
}

export function audioRevisionConstraintError(input: {
  source: Pick<V1Asset, "role" | "provenance" | "context" | "semanticAnalysis">;
  requestedMode?: AudioGenerationMode;
  requestedRole?: string;
  requestedSpokenTexts?: Array<string | undefined>;
}): string | null {
  const sourceModeRaw =
    input.source.provenance?.providerSettings?.audioMode;
  if (sourceModeRaw !== undefined && !isAudioMode(sourceModeRaw)) {
    return "Audio revision source has an unknown recorded audio mode.";
  }
  const sourceRole = input.source.role;
  const sourceRoleMode = sourceRole ? ROLE_MODE[sourceRole] : undefined;
  if (sourceRole && !sourceRoleMode) {
    return "Audio revision source has an unknown recorded audio role.";
  }

  const sourceModes = [
    ...(isAudioMode(sourceModeRaw) ? [sourceModeRaw] : []),
    ...(sourceRoleMode ? [sourceRoleMode] : []),
  ];
  if (sourceModes.length === 0) {
    return "Audio revision source has no trusted audio subtype.";
  }
  if (new Set(sourceModes).size !== 1) {
    return "Audio revision source has conflicting audio subtype metadata.";
  }
  if (!input.requestedMode) {
    return "Audio revision requires an explicit audio mode.";
  }
  if (input.requestedMode !== sourceModes[0]) {
    return "Audio revision cannot change the trusted source audio subtype.";
  }

  if (input.requestedRole !== undefined) {
    const requestedRoleMode = ROLE_MODE[input.requestedRole];
    if (!requestedRoleMode) {
      return "Audio revision requires a recognized audio role.";
    }
    if (requestedRoleMode !== input.requestedMode) {
      return "Audio revision role must match its audio mode.";
    }
    if (sourceRole && input.requestedRole !== sourceRole) {
      return "Audio revision cannot change the trusted source audio role.";
    }
  }

  if (
    input.requestedMode === "speech" ||
    input.requestedMode === "dialogue"
  ) {
    const sourceText = trustedAudioRevisionText(input.source);
    if (!sourceText) {
      return "Speech revision source has no trusted spoken text.";
    }
    const requestedTexts = (input.requestedSpokenTexts ?? [])
      .map(normalizedWords)
      .filter((text): text is string => Boolean(text));
    if (requestedTexts.length === 0) {
      return "Speech revision requires exact trusted spoken text.";
    }
    if (requestedTexts.some((text) => text !== sourceText)) {
      return "Speech revision cannot change the trusted source words.";
    }
  }

  return null;
}
