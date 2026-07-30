import type { StructuredArgs } from "@/lib/llm";
import { getLlmClient } from "@/lib/llm";
import { withLlmCostRecording } from "./llm-costs";

export const IMAGE_PROMPT_ENHANCEMENT_POLICY = "image_art_direction_v1";
export const MAX_IMAGE_PROMPT_LENGTH = 4_000;

export const IMAGE_PROMPT_ENHANCEMENT_SYSTEM = `You are an image art director.
Rewrite the creator's request into one production-ready image-generation prompt
that resists generic, glossy AI aesthetics.

Preserve the creator's subject, action, intent, named entities, requested text,
format, style, mood, and every explicit constraint. Do not add new people,
products, logos, visible text, lettering, copy, brand facts, plot points, or
culturally specific details that the creator did not request. If the prompt is
already well directed, edit lightly instead of making it longer.

When useful, make the image concrete through:
- subject, action, environment, and physical relationships;
- composition, viewpoint, shot distance, and a camera choice that serves it;
- a physically understandable light source, direction, and contrast;
- specific materials, surface texture, and a restrained palette;
- one dominant visual idea, focal hierarchy, and intentional negative space;
- believable wear, asymmetry, natural variation, or incidental detail.

Replace empty praise such as "stunning," "epic," "professional," "masterpiece,"
or "8K" with visible decisions. Prefer positive descriptions over long exclusion
lists. Avoid default orange-and-teal grading, excessive rim light, uniformly
glossy surfaces, fake shallow depth of field, over-sharpened microdetail, and
every element competing for attention unless the creator explicitly asks for
one of those traits.

Return only the rewritten prompt in the structured enhancedPrompt field. Keep it
coherent and concise; never exceed 4,000 characters.`;

type StructuredCall = <T extends object>(args: StructuredArgs) => Promise<T>;

export interface ImagePromptEnhancementDeps {
  structured?: StructuredCall;
  recordCost?: <T>(
    projectId: string,
    operation: () => Promise<T>
  ) => Promise<T>;
}

export interface ImagePromptEnhancement {
  effectivePrompt: string;
  policy: typeof IMAGE_PROMPT_ENHANCEMENT_POLICY;
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

export async function enhanceImagePrompt(
  projectId: string,
  originalPrompt: string,
  deps: ImagePromptEnhancementDeps = {}
): Promise<ImagePromptEnhancement> {
  const structured = deps.structured ?? defaultStructured;
  const recordCost = deps.recordCost ?? defaultRecordCost;
  const result = await recordCost(projectId, () =>
    structured<{ enhancedPrompt: string }>({
      cachedSystem: IMAGE_PROMPT_ENHANCEMENT_SYSTEM,
      user: originalPrompt,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          enhancedPrompt: {
            type: "string",
            minLength: 1,
            maxLength: MAX_IMAGE_PROMPT_LENGTH,
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
    effectivePrompt.length > MAX_IMAGE_PROMPT_LENGTH
  ) {
    throw new Error(
      `Image prompt enhancement must return between 1 and ${MAX_IMAGE_PROMPT_LENGTH} characters.`
    );
  }
  return {
    effectivePrompt,
    policy: IMAGE_PROMPT_ENHANCEMENT_POLICY,
  };
}
