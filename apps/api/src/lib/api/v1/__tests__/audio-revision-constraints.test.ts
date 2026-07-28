import assert from "node:assert/strict";
import test from "node:test";
import {
  audioRevisionConstraintError,
  providerEffectiveAudioRevisionText,
} from "../audio-revision-constraints";

function source(input: {
  role?: string;
  audioMode?: string;
  prompt?: string;
  providerPrompt?: string;
}) {
  return {
    role: input.role,
    provenance: {
      prompt: input.prompt ?? "The exact approved sentence.",
      providerPrompt: input.providerPrompt,
      providerSettings: {
        audioMode: input.audioMode,
      },
    },
  } as never;
}

test("matching speech revisions preserve subtype, role, and normalized words", () => {
  assert.equal(
    audioRevisionConstraintError({
      source: source({ role: "voiceover", audioMode: "speech" }),
      requestedMode: "speech",
      requestedRole: "voiceover",
      requestedSpokenTexts: ["  The exact   approved sentence. "],
    }),
    null
  );
});

test("an omitted requested role inherits the trusted source role", () => {
  assert.equal(
    audioRevisionConstraintError({
      source: source({ role: "soundtrack", audioMode: "music" }),
      requestedMode: "music",
    }),
    null
  );
});

test("audio revisions reject subtype and role changes", () => {
  assert.match(
    audioRevisionConstraintError({
      source: source({ role: "voiceover", audioMode: "speech" }),
      requestedMode: "music",
      requestedRole: "soundtrack",
    }) ?? "",
    /subtype/
  );
  assert.match(
    audioRevisionConstraintError({
      source: source({ role: "voiceover", audioMode: "speech" }),
      requestedMode: "speech",
      requestedRole: "dialogue",
      requestedSpokenTexts: ["The exact approved sentence."],
    }) ?? "",
    /role/
  );
});

test("audio revisions reject missing, unknown, and conflicting source subtype signals", () => {
  assert.match(
    audioRevisionConstraintError({
      source: source({}),
      requestedMode: "speech",
      requestedSpokenTexts: ["The exact approved sentence."],
    }) ?? "",
    /no trusted audio subtype/
  );
  assert.match(
    audioRevisionConstraintError({
      source: source({ role: "legacy_audio", audioMode: "speech" }),
      requestedMode: "speech",
      requestedSpokenTexts: ["The exact approved sentence."],
    }) ?? "",
    /unknown recorded audio role/
  );
  assert.match(
    audioRevisionConstraintError({
      source: source({ role: "soundtrack", audioMode: "speech" }),
      requestedMode: "speech",
      requestedSpokenTexts: ["The exact approved sentence."],
    }) ?? "",
    /conflicting audio subtype/
  );
});

test("speech revisions reject missing or changed trusted words", () => {
  assert.match(
    audioRevisionConstraintError({
      source: source({ role: "voiceover", audioMode: "speech" }),
      requestedMode: "speech",
      requestedRole: "voiceover",
    }) ?? "",
    /requires exact trusted spoken text/
  );
  assert.match(
    audioRevisionConstraintError({
      source: source({ role: "voiceover", audioMode: "speech" }),
      requestedMode: "speech",
      requestedRole: "voiceover",
      requestedSpokenTexts: ["Changed words."],
    }) ?? "",
    /cannot change the trusted source words/
  );
});

test("provider-effective text strips speech directives and joins voiced dialogue", () => {
  assert.equal(
    providerEffectiveAudioRevisionText({
      mode: "speech",
      prompt: "[Delivery: warm]\nThe exact approved sentence.",
    }),
    "The exact approved sentence."
  );
  assert.equal(
    providerEffectiveAudioRevisionText({
      mode: "dialogue",
      prompt: "",
      dialogueInputs: [
        { text: "First line.", voiceId: "voice_1" },
        { text: "Ignored line.", voiceId: "" },
        { text: "Second line.", voiceId: "voice_2" },
      ],
    }),
    "First line. Second line."
  );
});

test("provider prompt is the authoritative source spoken copy", () => {
  const providerSource = source({
    role: "voiceover",
    audioMode: "speech",
    prompt: "[Delivery: warm]\nThe exact approved sentence.",
    providerPrompt: "The exact approved sentence.",
  });
  assert.equal(
    audioRevisionConstraintError({
      source: providerSource,
      requestedMode: "speech",
      requestedRole: "voiceover",
      requestedSpokenTexts: ["The exact approved sentence."],
    }),
    null
  );
  assert.match(
    audioRevisionConstraintError({
      source: providerSource,
      requestedMode: "speech",
      requestedRole: "voiceover",
      requestedSpokenTexts: [
        "[Delivery: warm]\nThe exact approved sentence.",
      ],
    }) ?? "",
    /cannot change the trusted source words/
  );
});
