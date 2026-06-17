import type {
  StudioPlanningPreview,
  StudioPlanningPreviewRequest,
  StudioPlanningStoryFormat,
} from "@popcorn/shared/v1/studio-planning";
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

  const hookQuestion = textField(draft, "hookQuestion");
  const strongestVisual = textField(draft, "strongestVisual");
  const goal = textField(draft, "goal");
  const style = textField(draft, "style");
  const oneBigIdea = textField(draft, "oneBigIdea");

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

function createOpeningHook(draft: Record<string, unknown>): string {
  const hookQuestion = textField(draft, "hookQuestion");
  if (hookQuestion) return hookQuestion;

  const strongestVisual = textField(draft, "strongestVisual");
  if (strongestVisual) {
    return `Start on ${stripTrailingPunctuation(strongestVisual)}.`;
  }

  const oneBigIdea = textField(draft, "oneBigIdea");
  if (oneBigIdea) {
    return `What if ${stripTrailingPunctuation(oneBigIdea).toLowerCase()}?`;
  }

  const goal = textField(draft, "goal");
  if (goal) return `Here is the fastest way to understand ${goal}.`;

  return "Open with the clearest uploaded moment, then name what the viewer is about to learn.";
}

function createPosterPrompt(input: {
  draft: Record<string, unknown>;
  format: StudioPlanningStoryFormat;
  openingHook: string;
  hasFootage: boolean;
}): { prompt: string | null; visualDirection: string; missingInputs: string[] } {
  const { draft, format, openingHook, hasFootage } = input;
  const goal = textField(draft, "goal");
  const strongestVisual = textField(draft, "strongestVisual");
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

  return {
    storyDirection: {
      format,
      label: STORY_FORMAT_COPY[format].label,
      rationale: STORY_FORMAT_COPY[format].rationale,
    },
    openingHook,
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
