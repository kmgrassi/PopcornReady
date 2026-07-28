// LIVE Gate-0 decision evals: one REAL model call per scenario/sample, exactly
// like decision-evals.test.ts. SKIPPED unless the active provider's API key is
// present, keeping default CI green; run deliberately with a key (billable):
//   pnpm --filter @popcorn/api test
// The repeated-sample Gate-0 baseline report is the separate opt-in script:
//   pnpm --filter @popcorn/api evals:gate0 -- --samples 5

import "@/env";

import assert from "node:assert/strict";
import test from "node:test";

import { resolveLlmConfig } from "@/lib/llm";
import { describeOutcome, runDecisionScenario } from "../run-decision-eval";
import { GATE0_FLAT_SCENARIOS } from "../gate0-scenarios";
import {
  createRealFixtureDecisionModel,
  HIERARCHY_SCENARIOS,
  runHierarchyScenario,
} from "../hierarchy-fixture";
import { VISUALS_DECISION_SCENARIOS } from "../visuals-scenarios";

function liveLlmSkipReason(env: NodeJS.ProcessEnv = process.env): string | false {
  const provider = resolveLlmConfig(env).provider;
  const keyName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  if (!env[keyName]) return `no ${keyName} set — skipping Gate-0 live decision evals`;
  return false;
}

const skip = liveLlmSkipReason();

for (const scenario of GATE0_FLAT_SCENARIOS) {
  test(`gate0 flat routing — ${scenario.id}`, { skip }, async () => {
    const result = await runDecisionScenario(scenario);
    assert.ok(result.passed, `${scenario.description}\n  ${describeOutcome(result)}`);
  });
}

for (const scenario of [...HIERARCHY_SCENARIOS, ...VISUALS_DECISION_SCENARIOS]) {
  test(`gate0 hierarchy fixture routing — ${scenario.id}`, { skip }, async () => {
    const scored = await runHierarchyScenario(scenario, {
      model: createRealFixtureDecisionModel(),
    });
    assert.deepEqual(
      scored.classifications,
      scored.classifications.map(() => "acceptable"),
      `${scenario.description}\n  got ${scored.sampledDecisions
        .map((sample) => (sample.decision === "done" ? "done" : sample.toolName))
        .join(", ")}`
    );
  });
}
