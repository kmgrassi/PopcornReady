import assert from "node:assert/strict";
import test from "node:test";
import type { StructuredArgs } from "@/lib/llm";
import {
  enhanceVideoPrompt,
  MAX_VIDEO_PROMPT_LENGTH,
  VIDEO_PROMPT_ENHANCEMENT_POLICY,
  VIDEO_PROMPT_ENHANCEMENT_SYSTEM,
} from "../video-prompt-enhancement";

test("video prompt enhancement uses the fast structured lane and records project cost", async () => {
  const calls: StructuredArgs[] = [];
  const costProjects: string[] = [];
  const result = await enhanceVideoPrompt(
    "project_1",
    "An epic cinematic cyclist moving through a city, 8K",
    {
      structured: async <T extends object>(args: StructuredArgs) => {
        calls.push(args);
        return {
          enhancedPrompt:
            "One continuous street-level shot of a cyclist entering frame left, crossing wet pavement, and exiting frame right as the camera holds still.",
        } as T;
      },
      recordCost: async (projectId, operation) => {
        costProjects.push(projectId);
        return operation();
      },
    }
  );

  assert.equal(result.policy, VIDEO_PROMPT_ENHANCEMENT_POLICY);
  assert.match(result.effectivePrompt, /One continuous street-level shot/);
  assert.deepEqual(costProjects, ["project_1"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.user, "An epic cinematic cyclist moving through a city, 8K");
  assert.equal(calls[0]?.effort, "minimal");
  assert.equal(
    (calls[0]?.schema as {
      properties: { enhancedPrompt: { maxLength: number } };
    }).properties.enhancedPrompt.maxLength,
    4_000
  );
  assert.match(calls[0]?.cachedSystem ?? "", /default downstream clip is eight seconds/);
  assert.match(calls[0]?.cachedSystem ?? "", /opening state/);
  assert.match(calls[0]?.cachedSystem ?? "", /camera behavior described separately/);
  assert.match(calls[0]?.cachedSystem ?? "", /clear end state/);
});

test("video prompt enhancement rejects empty or oversized model output", async () => {
  for (const enhancedPrompt of ["   ", "x".repeat(MAX_VIDEO_PROMPT_LENGTH + 1)]) {
    await assert.rejects(
      enhanceVideoPrompt("project_1", "A cyclist crosses the street", {
        structured: async <T extends object>() => ({ enhancedPrompt }) as T,
        recordCost: async (_projectId, operation) => operation(),
      }),
      /between 1 and 4000 characters/
    );
  }
});

test("video policy forbids invented content, reference details, and gratuitous motion", () => {
  assert.match(
    VIDEO_PROMPT_ENHANCEMENT_SYSTEM,
    /Do not invent people, products,\s+logos, visible text, lettering, copy, brand facts, plot points, dialogue, audio/
  );
  assert.match(VIDEO_PROMPT_ENHANCEMENT_SYSTEM, /never invent their appearance or contents/);
  assert.match(VIDEO_PROMPT_ENHANCEMENT_SYSTEM, /Honor requested cuts or montage, but never add/);
  assert.match(VIDEO_PROMPT_ENHANCEMENT_SYSTEM, /Replace empty praise/);
  assert.match(VIDEO_PROMPT_ENHANCEMENT_SYSTEM, /edit lightly instead of making it longer/);
});
