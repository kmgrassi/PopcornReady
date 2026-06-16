// Load repo-root env files (.env.local / .env.<NODE_ENV> / .env) before anything
// reads process.env, so a locally-stored OPENAI_API_KEY/ANTHROPIC_API_KEY is
// picked up under `pnpm test` (tsx --test does not auto-load env files). Must be
// the first import — its dotenv side effect has to run before the skip check and
// the provider call below. Real process.env still wins (dotenv never overrides).
import "@/env";

import assert from "node:assert/strict";
import test from "node:test";

import type {
  OrchestratorRun,
  OrchestratorRunGate,
  RunActionSummary,
  UpdateOrchestratorRunPatch,
} from "@/lib/api/v1/orchestrator-store";
import { resolveLlmConfig } from "@/lib/llm";
import {
  runOrchestratorToCompletion,
  type InvocationRecord,
  type OrchestratorEngineStore,
} from "../engine";
import { orchestratorModel, type OrchestratorModel } from "../model";
import { createToolRegistry, type ToolRegistry } from "../registry";
import type { ToolName } from "../types";

// Live test: drives the REAL configured LLM (OpenAI by default, Anthropic when
// LLM_PROVIDER=anthropic) through the actual multi-turn orchestrator loop and
// proves PROPAGATION — that a completed tool's output is fed back into the
// model's input on the next turn (engine `priorResults`), so step N+1 reasons
// over what step N produced. The store is in-memory and tools return canned
// successes (real tool *descriptions*, fake execution) so the only real I/O is
// the model deciding the next tool each turn.
//
// SKIPPED unless the active provider's API key is present, so the default
// `pnpm test` run stays green in CI without secrets. To run it, put the key in a
// repo-root .env / .env.local (loaded via the import above) or pass it inline:
//   pnpm --filter @popcorn/api test            # uses repo-root .env(.local)
//   OPENAI_API_KEY=... pnpm --filter @popcorn/api test
//   LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... pnpm --filter @popcorn/api test
function liveLlmSkipReason(env: NodeJS.ProcessEnv = process.env): string | false {
  const provider = resolveLlmConfig(env).provider;
  const keyName = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
  if (!env[keyName]) {
    return `no ${keyName} set — skipping live LLM orchestrator loop`;
  }
  return false;
}

// Minimal in-memory store: no DB, no network. Records each executed tool as an
// action; the engine re-reads these actions and projects them into the next
// turn's `priorResults`, which is exactly the propagation we assert below.
class InMemoryStore implements OrchestratorEngineStore {
  run: OrchestratorRun;
  gates: OrchestratorRunGate[] = [];
  actions: RunActionSummary[] = [];

  constructor(run: OrchestratorRun) {
    this.run = run;
  }
  async getOrchestratorRun() {
    return { ...this.run };
  }
  async updateOrchestratorRun(_id: string, patch: UpdateOrchestratorRunPatch) {
    this.run = { ...this.run, ...patch };
    return { ...this.run };
  }
  async listRunGates() {
    return this.gates.map((g) => ({ ...g }));
  }
  async markGateReached() {
    return null;
  }
  async listRunActions() {
    return this.actions.map((a) => ({ ...a }));
  }
  async recordInvocation(input: InvocationRecord) {
    this.actions.push({
      id: `a${this.actions.length}`,
      tool: input.tool,
      status: input.status,
      params: input.params,
      outputAssetIds: input.outputAssetIds,
      jobIds: input.jobIds,
      error: input.error,
      createdAt: `t${this.actions.length}`,
    });
  }
  async markInvocation() {
    // no async jobs in this test (tools return sync successes)
  }
}

function runFixture(inputSummary: string): OrchestratorRun {
  return {
    id: "run-live",
    schemaVersion: "orchestrator_run.v1",
    projectId: "proj-live",
    status: "queued",
    inputSummary,
    spentUsd: 0,
    createdAt: "t0",
    updatedAt: "t0",
  };
}

// Keep the REAL tool descriptions/schemas (so the model makes sensible choices)
// but replace execution with a canned success that emits a recognizable asset id.
// Limiting to a couple of pipeline tools keeps the loop short (≈3 real calls).
function successRegistry(names: ToolName[]): ToolRegistry {
  const full = createToolRegistry();
  const map: ToolRegistry = new Map();
  for (const name of names) {
    const def = full.get(name);
    if (!def) throw new Error(`tool ${name} missing from registry`);
    map.set(name, {
      ...def,
      execute: async () => ({ status: "succeeded", resourceIds: [`${name}_asset`] }),
    });
  }
  return map;
}

type PriorResult = { tool: string; status: string; outputAssetIds: string[] };

test(
  "real LLM loop feeds a completed tool's output into the next turn's input",
  { skip: liveLlmSkipReason() },
  async () => {
    const store = new InMemoryStore(
      runFixture(
        "Create the project brief, then plan the shots for a 15-second 9:16 " +
          "video about a skateboarding puppy. Nothing has been generated yet."
      )
    );
    // Two ungated pipeline stages: brief, then plan. With no gates configured,
    // each result should flow straight into the next step.
    const registry = successRegistry(["create_or_load_brief", "plan_shots"]);

    // Wrap the real model to capture the `priorResults` it is handed each turn —
    // that input is how step N's output reaches step N+1.
    const priorResultsPerTurn: PriorResult[][] = [];
    const recordingModel: OrchestratorModel = async (input) => {
      priorResultsPerTurn.push((input.priorResults ?? []) as PriorResult[]);
      return orchestratorModel(input);
    };

    const run = await runOrchestratorToCompletion("run-live", {
      workspaceId: "ws-live",
      store,
      model: recordingModel,
      registry,
      maxTurns: 8,
    });

    const timeline = store.actions
      .map((a) => `${a.tool}[${a.status}]→${a.outputAssetIds.join(",")}`)
      .join("  |  ");
    console.log(`live loop: status=${run.status}  ${timeline}`);

    // The model must have driven at least two stages — a first tool, then a
    // second one — otherwise there is no propagation to observe.
    assert.ok(
      store.actions.length >= 2,
      `expected >= 2 tool calls so an output can propagate; got: ${timeline || "(none)"}`
    );

    // PROPAGATION: the first non-empty `priorResults` the model received must
    // mirror the already-persisted action(s) — same tool, same produced asset
    // ids. That is step N's real output arriving as step N+1's input.
    const firstWithPrior = priorResultsPerTurn.find((p) => p.length > 0);
    assert.ok(
      firstWithPrior && firstWithPrior.length > 0,
      "model never received a prior result — nothing propagated between steps"
    );
    assert.equal(firstWithPrior[0].tool, store.actions[0].tool);
    assert.equal(firstWithPrior[0].status, "applied");
    assert.deepEqual(firstWithPrior[0].outputAssetIds, store.actions[0].outputAssetIds);

    // And the loop reached a clean terminal state once work was done.
    assert.equal(
      run.status,
      "succeeded",
      `expected the loop to finish after its stages; got ${run.status}`
    );
  }
);
