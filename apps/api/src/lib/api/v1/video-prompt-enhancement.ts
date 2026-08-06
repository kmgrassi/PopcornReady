import type { StructuredArgs } from "@/lib/llm";
import { getLlmClient } from "@/lib/llm";
import { withLlmCostRecording } from "./llm-costs";

export const VIDEO_PROMPT_ENHANCEMENT_POLICY = "video_motion_direction_v1";
export const MAX_VIDEO_PROMPT_LENGTH = 4_000;

export const VIDEO_PROMPT_ENHANCEMENT_SYSTEM = `You are a video director.
Rewrite the creator's request into one production-ready prompt for a short,
single-shot video generation. The default downstream clip is eight seconds.

Preserve the creator's subject, action, intent, named entities, reference-asset
relationships, requested visible text or dialogue, format, style, mood, duration,
aspect ratio, and every explicit constraint. Do not invent people, products,
logos, visible text, lettering, copy, brand facts, plot points, dialogue, audio,
cuts, extra beats, durations, or simultaneous actions. You cannot inspect the
referenced assets, so never invent their appearance or contents. If the prompt
is already well directed, edit lightly instead of making it longer.

When useful, make the motion concrete through:
- the opening state, one feasible subject action, its trajectory, and a clear end state;
- temporal order and physically coherent spatial relationships;
- subject motion, environmental motion, and camera behavior described separately;
- a motivated static camera or one restrained move with understandable start and end positions;
- continuity of identity, geometry, wardrobe, objects, light, materials, and texture;
- believable weight, inertia, wind, reflections, contact, and incidental background motion.

Favor one coherent short shot. Honor requested cuts or montage, but never add
them. Replace empty praise such as "stunning," "epic," "professional,"
"cinematic," or "8K" with observable direction. Avoid gratuitous cuts,
competing camera and subject moves, impossible transformations, drifting object
geometry, random background motion, fake time-ramping, hyperactive camera work,
and every element moving at once unless the creator explicitly requests it.

Return only the rewritten prompt in the structured enhancedPrompt field. Keep it
coherent and concise; never exceed 4,000 characters.`;

type StructuredCall = <T extends object>(args: StructuredArgs) => Promise<T>;

export interface VideoPromptEnhancementDeps {
  structured?: StructuredCall;
  recordCost?: <T>(
    projectId: string,
    operation: () => Promise<T>
  ) => Promise<T>;
}

export interface VideoPromptEnhancement {
  effectivePrompt: string;
  policy: typeof VIDEO_PROMPT_ENHANCEMENT_POLICY;
}

function defaultStructured<T extends object>(args: StructuredArgs): Promise<T> {
  return getLlmClient().structured<T>(args);
}

function defaultRecordCost<T>(
  projectId: string,
  operation: () => Promise<T>
): Promise<T> {
  return withLlmCostRecording({ projectId }, operation);
}

export async function enhanceVideoPrompt(
  projectId: string,
  originalPrompt: string,
  deps: VideoPromptEnhancementDeps = {}
): Promise<VideoPromptEnhancement> {
  const structured = deps.structured ?? defaultStructured;
  const recordCost = deps.recordCost ?? defaultRecordCost;
  const result = await recordCost(projectId, () =>
    structured<{ enhancedPrompt: string }>({
      cachedSystem: VIDEO_PROMPT_ENHANCEMENT_SYSTEM,
      user: originalPrompt,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          enhancedPrompt: {
            type: "string",
            minLength: 1,
            maxLength: MAX_VIDEO_PROMPT_LENGTH,
          },
        },
        required: ["enhancedPrompt"],
      },
      maxTokens: 1_600,
      effort: "minimal",
    })
  );
  const effectivePrompt =
    typeof result.enhancedPrompt === "string"
      ? result.enhancedPrompt.trim()
      : "";
  if (
    !effectivePrompt ||
    effectivePrompt.length > MAX_VIDEO_PROMPT_LENGTH
  ) {
    throw new Error(
      `Video prompt enhancement must return between 1 and ${MAX_VIDEO_PROMPT_LENGTH} characters.`
    );
  }
  return {
    effectivePrompt,
    policy: VIDEO_PROMPT_ENHANCEMENT_POLICY,
  };
}
