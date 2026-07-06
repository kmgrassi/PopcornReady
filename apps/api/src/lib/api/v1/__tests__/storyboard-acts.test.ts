import assert from "node:assert/strict";
import { test } from "node:test";

import { STORYBOARD_SKETCH_STYLE_PRESET } from "@/lib/generative/sketch-style";
import { buildActMockupPrompt } from "../storyboard-acts";

test("buildActMockupPrompt leads with the sketch preset, then act context", () => {
  const prompt = buildActMockupPrompt({
    title: "Setup",
    purpose: "Orient the viewer and establish why the story matters.",
    summary: "Open on the cafe at dawn as regulars trickle in.",
  });

  assert.ok(prompt.startsWith(STORYBOARD_SKETCH_STYLE_PRESET));
  const afterPreset = prompt.slice(STORYBOARD_SKETCH_STYLE_PRESET.length);
  assert.match(afterPreset, /Act: Setup\./);
  assert.match(afterPreset, /Narrative purpose: Orient the viewer/);
  assert.match(
    afterPreset,
    /Depict the whole act in one storyboard panel: Open on the cafe at dawn/
  );
});

test("buildActMockupPrompt prefers the caller's prompt override", () => {
  const prompt = buildActMockupPrompt(
    {
      title: "Payoff",
      purpose: "Land the final beat.",
      summary: "The crowd cheers.",
    },
    "  A quiet, bittersweet farewell at closing time.  "
  );

  assert.match(prompt, /A quiet, bittersweet farewell at closing time\./);
  assert.doesNotMatch(prompt, /The crowd cheers/);
});

test("buildActMockupPrompt degrades cleanly when act fields are missing", () => {
  const prompt = buildActMockupPrompt({ title: null, purpose: null, summary: null });

  assert.ok(prompt.startsWith(STORYBOARD_SKETCH_STYLE_PRESET));
  assert.doesNotMatch(prompt, /Act:/);
  assert.doesNotMatch(prompt, /Narrative purpose:/);
  assert.match(prompt, /A single panel that captures the arc of this act\./);
});
