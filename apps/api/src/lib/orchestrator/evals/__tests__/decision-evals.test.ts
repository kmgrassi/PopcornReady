// Load repo-root env files first so a locally-stored OPENAI_API_KEY/ANTHROPIC_API_KEY
// is picked up under `pnpm test` (tsx --test does not auto-load env files).
import "@/env";

import assert from "node:assert/strict";
import test from "node:test";

import { resolveLlmConfig } from "@/lib/llm";
import { runDecisionScenario, describeOutcome } from "../run-decision-eval";
import { ALL_SCENARIOS } from "../scenarios";

// Each scenario is a real LLM call, so the suite is SKIPPED unless the active
// provider's API key is present — keeping the default `pnpm test` green in CI.
// Run it deliberately with a key:
//   pnpm --filter @popcorn/api test            # uses repo-root .env(.local)
//   OPENAI_API_KEY=... pnpm --filter @popcorn/api test
function liveLlmSkipReason(env: NodeJS.ProcessEnv = process.env): string | false {
  const provider = resolveLlmConfig(env).provider;
  const keyName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  if (!env[keyName]) return `no ${keyName} set — skipping orchestrator decision evals`;
  return false;
}

const skip = liveLlmSkipReason();

// One test per scenario: assert the orchestrator routes to an acceptable next tool
// (or stops) given the fabricated state-so-far.
for (const scenario of ALL_SCENARIOS) {
  test(`orchestrator routing — ${scenario.id}`, { skip }, async () => {
    const result = await runDecisionScenario(scenario);
    assert.ok(result.passed, `${scenario.description}\n  ${describeOutcome(result)}`);
  });
}
