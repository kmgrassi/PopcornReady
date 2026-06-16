import assert from "node:assert/strict";
import test from "node:test";

import { resolveLlmConfig } from "@/lib/llm";
import { orchestratorModel } from "../model";
import { createToolRegistry } from "../registry";
import { TOOL_NAMES } from "../types";

// Live test: exercises the REAL configured LLM (OpenAI by default, Anthropic when
// LLM_PROVIDER=anthropic) through one orchestrator turn — the model receives the
// real tool catalog and must pick the next tool. Everything else (engine, store,
// tool execution) is fakeable and covered by engine.test.ts; this is the one
// place we confirm the model wiring actually round-trips a provider call.
//
// It is SKIPPED unless the active provider's API key is present, so the default
// `pnpm test` run stays green in CI without secrets. To run it:
//   OPENAI_API_KEY=... pnpm --filter @popcorn/api test
//   LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... pnpm --filter @popcorn/api test
function liveLlmSkipReason(env: NodeJS.ProcessEnv = process.env): string | false {
  const provider = resolveLlmConfig(env).provider;
  const keyName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  if (!env[keyName]) {
    return `no ${keyName} set — skipping live LLM orchestrator turn`;
  }
  return false;
}

test(
  "real LLM picks a valid first tool for a fresh video prompt",
  { skip: liveLlmSkipReason() },
  async () => {
    const registry = createToolRegistry();

    const decision = await orchestratorModel({
      projectId: "live-test-project",
      inputSummary:
        "Make a 15-second 9:16 video about a skateboarding puppy. Nothing has been generated yet.",
      priorResults: [],
      registry,
    });

    // With no prior work done, the model must choose to call a real tool (not
    // finish), and the chosen tool must be one the engine knows how to run.
    assert.equal(
      decision.type,
      "tool_call",
      `expected a tool call with work remaining, got: ${JSON.stringify(decision)}`
    );
    if (decision.type !== "tool_call") return; // narrow for TS

    assert.ok(
      (TOOL_NAMES as readonly string[]).includes(decision.toolName),
      `model chose an unknown tool: ${decision.toolName}`
    );
    assert.ok(decision.model, "decision should report which model produced it");

    // Not an assertion (real models vary), but handy when running locally to see
    // the model open with the natural first stage (e.g. create_or_load_brief).
    console.log(`live orchestrator turn → ${decision.toolName} (model: ${decision.model})`);
  }
);
