import assert from "node:assert/strict";
import test from "node:test";
import type { StructuredArgs } from "@/lib/llm";
import {
  enhanceImagePrompt,
  IMAGE_PROMPT_ENHANCEMENT_POLICY,
  IMAGE_PROMPT_ENHANCEMENT_SYSTEM,
  MAX_IMAGE_PROMPT_LENGTH,
} from "../image-prompt-enhancement";

test("image prompt enhancement uses the fast structured lane and records project cost", async () => {
  const calls: StructuredArgs[] = [];
  const costProjects: string[] = [];
  const result = await enhanceImagePrompt(
    "project_1",
    "A stunning epic futuristic city, masterpiece, 8K",
    {
      structured: async <T extends object>(args: StructuredArgs) => {
        calls.push(args);
        return {
          enhancedPrompt:
            "Street-level photograph of a compact methane-processing settlement at dusk. Workers cross a wet metal walkway beneath flat amber overcast light.",
        } as T;
      },
      recordCost: async (projectId, operation) => {
        costProjects.push(projectId);
        return operation();
      },
    }
  );

  assert.equal(result.policy, IMAGE_PROMPT_ENHANCEMENT_POLICY);
  assert.match(result.effectivePrompt, /Street-level photograph/);
  assert.deepEqual(costProjects, ["project_1"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.user, "A stunning epic futuristic city, masterpiece, 8K");
  assert.equal(calls[0]?.effort, "minimal");
  assert.match(calls[0]?.cachedSystem ?? "", /Preserve the creator's subject/);
  assert.match(calls[0]?.cachedSystem ?? "", /physical relationships/);
  assert.match(calls[0]?.cachedSystem ?? "", /physically understandable light source/);
  assert.match(calls[0]?.cachedSystem ?? "", /one dominant visual idea/);
  assert.match(calls[0]?.cachedSystem ?? "", /believable wear/);
});

test("image prompt enhancement rejects empty or oversized model output", async () => {
  for (const enhancedPrompt of ["   ", "x".repeat(MAX_IMAGE_PROMPT_LENGTH + 1)]) {
    await assert.rejects(
      enhanceImagePrompt("project_1", "A portrait", {
        structured: async <T extends object>() => ({ enhancedPrompt }) as T,
        recordCost: async (_projectId, operation) => operation(),
      }),
      /between 1 and 4000 characters/
    );
  }
});

test("image prompt enhancement policy forbids unrequested content and generic quality filler", () => {
  assert.match(
    IMAGE_PROMPT_ENHANCEMENT_SYSTEM,
    /Do not add new people,\s+products, logos, visible text, lettering, copy, brand facts/
  );
  assert.match(IMAGE_PROMPT_ENHANCEMENT_SYSTEM, /Replace empty praise/);
  assert.match(IMAGE_PROMPT_ENHANCEMENT_SYSTEM, /Prefer positive descriptions/);
  assert.match(IMAGE_PROMPT_ENHANCEMENT_SYSTEM, /edit\s+lightly instead of making it longer/);
});
