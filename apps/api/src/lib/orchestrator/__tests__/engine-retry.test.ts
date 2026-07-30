import assert from "node:assert/strict";
import test from "node:test";

import type {
  OrchestratorRun,
  OrchestratorRunGate,
  RunActionSummary,
  UpdateOrchestratorRunPatch,
} from "@/lib/api/v1/orchestrator-store";
import {
  runOrchestratorToCompletion,
  type InvocationRecord,
  type OrchestratorEngineStore,
} from "../engine";
import type { OrchestratorModel } from "../model";
import type { ToolCallResult, ToolName } from "../types";
import type { ToolRegistry } from "../registry";
import { driverToolDefinitionMetadata } from "@/lib/orchestrator-tools/capability-catalog";

// A store that throws on the first `listRunActions` call (a transient read blip),
// then behaves normally. Without step-level retry this would fail the whole run.
class FlakyReadStore implements OrchestratorEngineStore {
  run: OrchestratorRun;
  actions: RunActionSummary[] = [];
  listCalls = 0;

  constructor(run: OrchestratorRun) {
    this.run = run;
  }
  async getOrchestratorRun() {
    return { ...this.run };
  }
  async updateOrchestratorRun(_id: string, patch: UpdateOrchestratorRunPatch) {
    const { waitReason, ...rest } = patch;
    this.run = { ...this.run, ...rest };
    if (waitReason) this.run.waitReason = waitReason;
    else if (waitReason === null) delete this.run.waitReason;
    return { ...this.run };
  }
  async listRunGates(): Promise<OrchestratorRunGate[]> {
    return [];
  }
  async markGateReached() {
    return null;
  }
  async listRunActions() {
    this.listCalls += 1;
    if (this.listCalls === 1) throw new Error("transient read failure");
    return this.actions.map((a) => ({ ...a }));
  }
  async recordInvocation(input: InvocationRecord) {
    this.actions.push({
      id: input.actionId,
      tool: input.tool,
      status: input.status,
      params: input.params,
      outputAssetIds: input.outputAssetIds,
      jobIds: input.jobIds,
      error: input.error,
      createdAt: `t${this.actions.length}`,
    });
  }
  async markInvocation() {}
}

function fakeRegistry(): ToolRegistry {
  const ok: ToolCallResult = { status: "succeeded", resourceIds: ["asset_plan"] };
  const map: ToolRegistry = new Map();
  map.set("plan_shots" as ToolName, {
    ...driverToolDefinitionMetadata("plan_shots"),
    description: "",
    inputSchema: {},
    outputSchema: {},
    requiredResourceIds: [],
    estimateCostUsd: () => undefined,
    execute: async () => ok,
  });
  return map;
}

function scriptedModel(seq: Array<{ type: "tool_call"; toolName: ToolName } | { type: "done" }>): OrchestratorModel {
  let i = 0;
  return async () => {
    const d = seq[Math.min(i, seq.length - 1)];
    i += 1;
    return d.type === "done"
      ? { type: "done", summary: "done", model: "scripted" }
      : { type: "tool_call", toolName: d.toolName, input: {}, model: "scripted" };
  };
}

test("a transient store read is retried instead of failing the run", async () => {
  const store = new FlakyReadStore({
    id: "run1",
    schemaVersion: "orchestrator_run.v1",
    projectId: "proj1",
    status: "queued",
    inputSummary: "make a short video",
    rootExecutionProfile: "creative_director",
    spentUsd: 0,
    createdAt: "t0",
    updatedAt: "t0",
  });

  const run = await runOrchestratorToCompletion("run1", {
    workspaceId: "ws1",
    store,
    model: scriptedModel([{ type: "tool_call", toolName: "plan_shots" as ToolName }, { type: "done" }]),
    registry: fakeRegistry(),
    resolveAgentDefinition: async () => ({
      role: "creative_director",
      registry: fakeRegistry(),
      systemPrompt: "test creative director",
      loadTurnContext: async () => undefined,
    }),
    retry: { attempts: 3, sleep: async () => {} }, // no real backoff wait in tests
    resolveOwnerUserId: async () => null, // keep the fake-store run DB-free
  });

  assert.equal(run.status, "succeeded", "the run should survive a transient read blip");
  assert.ok(store.listCalls >= 2, "the failed read must have been retried");
  assert.equal(store.actions.length, 1);
  assert.equal(store.actions[0].tool, "plan_shots");
});
