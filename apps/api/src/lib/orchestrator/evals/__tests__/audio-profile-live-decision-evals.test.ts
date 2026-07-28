import "@/env";

import assert from "node:assert/strict";
import test from "node:test";

import { resolveLlmConfig } from "@/lib/llm";
import {
  AUDIO_PROFILE_SCENARIOS,
  createRealAudioProfileDecisionModel,
  runAudioProfileScenario,
} from "../audio-profile-scenarios";

function liveLlmSkipReason(env: NodeJS.ProcessEnv = process.env): string | false {
  const provider = resolveLlmConfig(env).provider;
  const keyName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  return env[keyName] ? false : `no ${keyName} set — skipping Audio profile live evals`;
}

const skip = liveLlmSkipReason();

for (const scenario of AUDIO_PROFILE_SCENARIOS) {
  test(`Audio profile live decision — ${scenario.id}`, { skip }, async () => {
    const result = await runAudioProfileScenario(
      scenario,
      createRealAudioProfileDecisionModel()
    );
    assert.equal(
      result.passed,
      true,
      `${scenario.description}\nExpected ${JSON.stringify(scenario.expect)}, got ${JSON.stringify(result.decision)}`
    );
  });
}
