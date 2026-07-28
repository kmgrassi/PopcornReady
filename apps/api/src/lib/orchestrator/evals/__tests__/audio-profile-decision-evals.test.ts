import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDIO_PROFILE_SCENARIOS,
  runAudioProfileScenario,
} from "../audio-profile-scenarios";

test("Audio profile decision evals cover the PR 11 acceptance families", () => {
  assert.deepEqual(
    new Set(AUDIO_PROFILE_SCENARIOS.map((scenario) => scenario.id)),
    new Set([
      "audio_voiceover_exact_script",
      "audio_production_music_bed",
      "audio_standalone_soundtrack",
      "audio_standalone_sound_effect",
      "audio_refit_to_current_picture",
      "audio_warmer_delivery",
      "audio_change_dialogue_meaning",
      "audio_picture_too_short_for_exact_words",
    ])
  );
});

for (const scenario of AUDIO_PROFILE_SCENARIOS) {
  test(`Audio profile scripted decision — ${scenario.id}`, async () => {
    const result = await runAudioProfileScenario(scenario, async ({ tools }) => {
      assert.deepEqual(
        new Set(tools.map((tool) => tool.name)),
        new Set(["generate_audio", "fit_audio_to_picture"])
      );
      return scenario.expect.type === "tool_call"
        ? { type: "tool_call", toolName: scenario.expect.toolName }
        : { type: "terminal", outcome: scenario.expect.outcome };
    });
    assert.equal(result.passed, true);
  });
}
