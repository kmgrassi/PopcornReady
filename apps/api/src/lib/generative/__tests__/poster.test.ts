import assert from "node:assert/strict";
import test from "node:test";
import { buildPosterPrompt } from "../poster";

test("buildPosterPrompt creates key-art prompt without rendered text", () => {
  const prompt = buildPosterPrompt({
    brief: {
      goal: "Explain why correlation does not prove causation.",
      targetLengthSec: 60,
      aspectRatio: "9:16",
      audience: "true beginners",
      style: "clean classroom demo",
    },
    planSummary: "Ice cream sales and swimming rise together because of heat.",
    heroAnchorDescription: "two simple charts moving together",
  });

  assert.match(prompt, /correlation does not prove causation/);
  assert.match(prompt, /true beginners/);
  assert.match(prompt, /two simple charts/);
  assert.match(prompt, /2:3 poster composition/);
  assert.match(prompt, /Do not include title text/);
});
