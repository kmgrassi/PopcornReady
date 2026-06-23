import type {
  StudioPlanningBeatOutlineItem,
  StudioPlanningPreview,
  StudioPlanningPreviewRequest,
  StudioPlanningStoryFormat,
  StudioPlanningStoryResponse,
} from "@popcorn/shared/v1/studio-planning";
import { getLlmClient, type LlmClient } from "@popcorn/llm";
import { STORY_FORMATS } from "./schemas";

type StoryFormatCopy = {
  label: string;
  rationale: string;
};

const STORY_FORMAT_COPY: Record<StudioPlanningStoryFormat, StoryFormatCopy> = {
  mystery_to_model: {
    label: "Mystery to model",
    rationale:
      "Lead with a question or surprising detail, then resolve it with a simple model.",
  },
  visual_reveal: {
    label: "Visual reveal",
    rationale:
      "Use the strongest uploaded visual as the first decision and build the story around the reveal.",
  },
  challenge: {
    label: "Challenge",
    rationale:
      "Frame the piece around an attempt, constraint, or test the viewer can track quickly.",
  },
  misconception: {
    label: "Misconception",
    rationale:
      "Open on the common wrong assumption, then replace it with the useful takeaway.",
  },
  animated_explainer: {
    label: "Animated explainer",
    rationale:
      "Prioritize clean explanation beats when the idea matters more than captured footage.",
  },
  classroom_demo: {
    label: "Classroom demo",
    rationale:
      "Turn the brief into a practical demo with clear setup, action, and payoff.",
  },
  aesthetic_montage: {
    label: "Aesthetic montage",
    rationale:
      "Let mood, rhythm, and visual texture carry the story when the goal is atmospheric.",
  },
};

function textField(draft: Record<string, unknown>, key: string): string | undefined {
  const value = draft[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function textFieldAny(
  draft: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = textField(draft, key);
    if (value) return value;
  }
  return undefined;
}

function includesAny(value: string | undefined, terms: string[]): boolean {
  const lower = value?.toLowerCase() ?? "";
  return terms.some((term) => lower.includes(term));
}

function formatFromDraft(
  draft: Record<string, unknown>
): StudioPlanningStoryFormat | undefined {
  const value = draft.format;
  if (typeof value !== "string") return undefined;
  if (!STORY_FORMATS.includes(value as StudioPlanningStoryFormat)) return undefined;
  return value as StudioPlanningStoryFormat;
}

function chooseStoryFormat(
  draft: Record<string, unknown>
): StudioPlanningStoryFormat {
  const requested = formatFromDraft(draft);
  if (requested) return requested;

  const hookQuestion = textFieldAny(draft, ["hookQuestion", "hook"]);
  const strongestVisual = textFieldAny(draft, ["strongestVisual", "bestVisual"]);
  const goal = textField(draft, "goal");
  const style = textField(draft, "style");
  const oneBigIdea = textFieldAny(draft, ["oneBigIdea", "bigIdea"]);

  if (hookQuestion?.endsWith("?")) return "mystery_to_model";
  if (strongestVisual) return "visual_reveal";
  if (includesAny(goal, ["challenge", "test", "try", "attempt"])) return "challenge";
  if (includesAny(goal, ["myth", "misconception", "wrong", "truth"])) {
    return "misconception";
  }
  if (includesAny(style, ["demo", "classroom", "tutorial"])) return "classroom_demo";
  if (includesAny(style, ["cinematic", "montage", "aesthetic"])) {
    return "aesthetic_montage";
  }
  if (oneBigIdea) return "animated_explainer";
  return "visual_reveal";
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.!?]+$/u, "");
}

function sentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /[.!?]$/u.test(trimmed) ? trimmed : `${trimmed}.`;
}

function oneSentence(value: string): string {
  const cleaned = value
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/gu, "")
    .replace(/^story\s*:\s*/iu, "")
    .replace(/\s+/gu, " ");
  if (!cleaned) return "";
  const match = cleaned.match(/^.+?[.!?](?=\s|$)/u);
  return sentence(match?.[0] ?? cleaned);
}

function createOpeningHook(draft: Record<string, unknown>): string {
  const hookQuestion = textFieldAny(draft, ["hookQuestion", "hook"]);
  if (hookQuestion) return hookQuestion;

  const strongestVisual = textFieldAny(draft, ["strongestVisual", "bestVisual"]);
  if (strongestVisual) {
    return `Start on ${stripTrailingPunctuation(strongestVisual)}.`;
  }

  const oneBigIdea = textFieldAny(draft, ["oneBigIdea", "bigIdea"]);
  if (oneBigIdea) {
    return `What if ${stripTrailingPunctuation(oneBigIdea).toLowerCase()}?`;
  }

  const goal = textField(draft, "goal");
  if (goal) return `Here is the fastest way to understand ${goal}.`;

  return "Open with the clearest uploaded moment, then name what the viewer is about to learn.";
}

function beat(
  id: string,
  label: string,
  text: string,
  role?: StudioPlanningBeatOutlineItem["role"]
): StudioPlanningBeatOutlineItem {
  return role ? { id, label, text: sentence(text), role } : { id, label, text: sentence(text) };
}

function createBeatOutline(input: {
  draft: Record<string, unknown>;
  format: StudioPlanningStoryFormat;
  openingHook: string;
  hasFootage: boolean;
}): StudioPlanningBeatOutlineItem[] {
  const { draft, format, openingHook, hasFootage } = input;
  const goal = textField(draft, "goal");
  const oneBigIdea = textFieldAny(draft, ["oneBigIdea", "bigIdea"]);
  const payoff = textField(draft, "payoff");
  const callToAction = textField(draft, "callToAction");
  const strongestVisual = textFieldAny(draft, ["strongestVisual", "bestVisual"]);

  const setupText =
    goal ??
    oneBigIdea ??
    "Establish the viewer's problem and the specific idea this video will resolve.";
  const generatedVisualSubject =
    goal ??
    oneBigIdea ??
    STORY_FORMAT_COPY[format].label.toLowerCase();
  const visualText = strongestVisual
    ? `Use ${stripTrailingPunctuation(strongestVisual)} as the visual proof point`
    : hasFootage
      ? "Select the strongest uploaded moment as the proof point"
      : `Generate visuals that make this idea concrete: ${stripTrailingPunctuation(generatedVisualSubject)}`;
  const ideaText =
    oneBigIdea ??
    STORY_FORMAT_COPY[format].rationale;
  const payoffText =
    payoff ??
    callToAction ??
    (goal ? `Resolve the video back to ${stripTrailingPunctuation(goal)}` : "End with the clearest takeaway.");

  switch (format) {
    case "mystery_to_model":
      return [
        beat("beat_hook", "Hook", openingHook, "hook"),
        beat("beat_clue", "Clue", visualText),
        beat("beat_model", "Model", ideaText),
        beat("beat_payoff", "Payoff", payoffText, "payoff"),
      ];
    case "challenge":
      return [
        beat("beat_hook", "Challenge", openingHook, "hook"),
        beat("beat_setup", "Setup", setupText),
        beat("beat_attempt", "Attempt", visualText),
        beat("beat_result", "Result", payoffText, "payoff"),
      ];
    case "misconception":
      return [
        beat("beat_hook", "Assumption", openingHook, "hook"),
        beat("beat_evidence", "Evidence", visualText),
        beat("beat_reframe", "Reframe", ideaText),
        beat("beat_payoff", "Takeaway", payoffText, "payoff"),
      ];
    case "animated_explainer":
      return [
        beat("beat_hook", "Idea", openingHook, "hook"),
        beat("beat_context", "Context", setupText),
        beat("beat_model", "Model", ideaText),
        beat("beat_example", "Example", visualText),
        beat("beat_payoff", "Payoff", payoffText, "payoff"),
      ];
    case "classroom_demo":
      return [
        beat("beat_hook", "Setup", openingHook, "hook"),
        beat("beat_demo", "Demo", visualText),
        beat("beat_explain", "Explain", ideaText),
        beat("beat_payoff", "Takeaway", payoffText, "payoff"),
      ];
    case "aesthetic_montage":
      return [
        beat("beat_hook", "Mood", openingHook, "hook"),
        beat("beat_texture", "Texture", visualText),
        beat("beat_rhythm", "Rhythm", setupText),
        beat("beat_payoff", "Landing", payoffText, "payoff"),
      ];
    case "visual_reveal":
    default:
      return [
        beat("beat_hook", "Reveal", openingHook, "hook"),
        beat("beat_context", "Context", setupText),
        beat("beat_proof", "Proof", visualText),
        beat("beat_payoff", "Payoff", payoffText, "payoff"),
      ];
  }
}

function createPosterPrompt(input: {
  draft: Record<string, unknown>;
  format: StudioPlanningStoryFormat;
  openingHook: string;
  hasFootage: boolean;
}): { prompt: string | null; visualDirection: string; missingInputs: string[] } {
  const { draft, format, openingHook, hasFootage } = input;
  const goal = textField(draft, "goal");
  const strongestVisual = textFieldAny(draft, ["strongestVisual", "bestVisual"]);
  const style = textField(draft, "style");
  const audience = textField(draft, "audience");

  const missingInputs: string[] = [];
  if (!goal) missingInputs.push("briefDraft.goal");
  if (!strongestVisual && !hasFootage) missingInputs.push("strongestVisual or footageAssetIds");

  const visualDirection = strongestVisual
    ? `Feature ${stripTrailingPunctuation(strongestVisual)} as the hero image with a clear ${STORY_FORMAT_COPY[format].label.toLowerCase()} read.`
    : "Use the clearest uploaded footage frame as the hero image with strong subject separation and minimal text.";

  if (missingInputs.length > 0) {
    return { prompt: null, visualDirection, missingInputs };
  }

  const parts = [
    `Poster/key visual for: ${goal}`,
    `Opening hook: ${openingHook}`,
    `Story format: ${STORY_FORMAT_COPY[format].label}`,
    `Visual direction: ${visualDirection}`,
  ];
  if (style) parts.push(`Style: ${style}`);
  if (audience) parts.push(`Audience: ${audience}`);
  parts.push("Make it legible as a short-form video cover; avoid dense copy.");

  return {
    prompt: parts.join("\n"),
    visualDirection,
    missingInputs,
  };
}

export function createStudioPlanningPreview(
  request: StudioPlanningPreviewRequest
): StudioPlanningPreview {
  const format = chooseStoryFormat(request.briefDraft);
  const openingHook = createOpeningHook(request.briefDraft);
  const poster = createPosterPrompt({
    draft: request.briefDraft,
    format,
    openingHook,
    hasFootage: (request.footageAssetIds?.length ?? 0) > 0,
  });
  const beats = createBeatOutline({
    draft: request.briefDraft,
    format,
    openingHook,
    hasFootage: (request.footageAssetIds?.length ?? 0) > 0,
  });

  return {
    storyDirection: {
      format,
      label: STORY_FORMAT_COPY[format].label,
      rationale: STORY_FORMAT_COPY[format].rationale,
    },
    openingHook,
    beats,
    poster: {
      status:
        poster.missingInputs.length === 0
          ? "ready_for_background"
          : "pending_input",
      backgroundReady: poster.missingInputs.length === 0,
      prompt: poster.prompt,
      visualDirection: poster.visualDirection,
      reason:
        poster.missingInputs.length > 0
          ? `Needs ${poster.missingInputs.join(" and ")} before poster generation.`
          : undefined,
    },
    source: {
      mode: "deterministic",
      llmEnriched: false,
      missingInputs: poster.missingInputs,
    },
  };
}

export interface CreateStudioPlanningStoryDeps {
  llm?: LlmClient;
}

export async function createStudioPlanningStory(
  request: StudioPlanningPreviewRequest,
  deps: CreateStudioPlanningStoryDeps = {}
): Promise<StudioPlanningStoryResponse> {
  const preview = createStudioPlanningPreview(request);
  const llm = deps.llm ?? getLlmClient();
  const result = await llm.structured<{ story: string }>({
    cachedSystem:
      "You write concise movie plot loglines for short videos. Return only the requested story sentence. Do not include labels, markdown, lists, beat names, production notes, camera directions, visual prompts, or explanations.",
    user: JSON.stringify({
      userPrompt: textField(request.briefDraft, "goal"),
      draft: request.briefDraft,
      deterministicStory: {
        format: preview.storyDirection.label,
        openingHook: preview.openingHook,
        beats: preview.beats.map((beat) => beat.text),
        payoff: textField(request.briefDraft, "payoff"),
      },
      instruction:
        "Smooth the deterministic story into exactly one sentence that describes only the movie plot/story.",
    }),
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        story: {
          type: "string",
          description:
            "Exactly one sentence containing only the movie plot/story. No prefix, label, markdown, shot list, beat list, or production notes.",
        },
      },
      required: ["story"],
    },
    maxTokens: 140,
    effort: "minimal",
  });

  const story = oneSentence(result.story);
  if (!story) {
    return {
      story: sentence(
        [
          textField(request.briefDraft, "goal"),
          preview.beats.map((beat) => stripTrailingPunctuation(beat.text)).join(", then "),
        ]
          .filter(Boolean)
          .join(": ")
      ),
    };
  }
  return { story };
}
