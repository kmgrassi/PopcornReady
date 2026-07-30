// PR 6 engine coverage: the delegated result parks the root run in the DOMAIN
// wait (distinct from media-job/approval waits), and resume reconciles the
// running delegate_* invocation against the durable child run — staying parked
// while the child is active, retrying recoverably when the child vanished or
// ended without a report, and proceeding once finalization applied the action.
// Fake store + fake registry only: the durable transport itself is covered by
// the local-DB integration suite (turn-boundary-dispatch.integration.test.ts).

import assert from "node:assert/strict";
import test from "node:test";

import type {
  OrchestratorRun,
  OrchestratorRunGate,
  RunActionSummary,
  UpdateOrchestratorRunPatch,
} from "@/lib/api/v1/orchestrator-store";
import {
  resumeOrchestratorRun,
  runOrchestratorToCompletion,
  type EngineDeps,
  type InvocationRecord,
  type OrchestratorEngineStore,
} from "../engine";
import type { ToolCallResult, ToolExecutionContext, ToolName } from "../types";
import type { OrchestratorModel } from "../model";
import type { ToolRegistry } from "../registry";
import { driverToolDefinitionMetadata } from "@/lib/orchestrator-tools/capability-catalog";

function runFixture(over: Partial<OrchestratorRun> = {}): OrchestratorRun {
  return {
    id: "root1",
    schemaVersion: "orchestrator_run.v1",
    projectId: "proj1",
    status: "queued",
    inputSummary: "make a 15s video",
    spentUsd: 0,
    createdAt: "t0",
    updatedAt: "t0",
    ...over,
  };
}

class FakeStore implements OrchestratorEngineStore {
  run: OrchestratorRun;
  gates: OrchestratorRunGate[] = [];
  actions: RunActionSummary[] = [];
  childRuns = new Map<string, { id: string; status: string }>();

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
  async claimOrchestratorRunResume() {
    if (this.run.status !== "waiting") return null;
    this.run = { ...this.run, status: "running" };
    delete this.run.waitReason;
    return { ...this.run };
  }
  async listRunGates() {
    return this.gates.map((gate) => ({ ...gate }));
  }
  async markGateReached() {
    return null;
  }
  async listRunActions() {
    return this.actions.map((action) => ({ ...action }));
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
      createdAt: `t${this.actions.length + 1}`,
    });
  }
  async markInvocation(
    actionId: string,
    patch: {
      status: "running" | "applied" | "failed";
      jobIds?: string[];
      outputAssetIds?: string[];
      error?: Record<string, unknown>;
    }
  ) {
    const action = this.actions.find((candidate) => candidate.id === actionId);
    if (!action) return;
    action.status = patch.status;
    if (patch.jobIds) action.jobIds = patch.jobIds;
    if (patch.outputAssetIds) action.outputAssetIds = patch.outputAssetIds;
    if (patch.error) action.error = patch.error;
  }
  async findDelegatedChildRun(rootActionId: string) {
    return this.childRuns.get(rootActionId) ?? null;
  }
}

function delegateRegistry(
  execute: (context: ToolExecutionContext) => ToolCallResult
): ToolRegistry {
  const map: ToolRegistry = new Map();
  map.set("delegate_visuals", {
    ...driverToolDefinitionMetadata("delegate_visuals"),
    description: "",
    inputSchema: {},
    outputSchema: {},
    requiredResourceIds: [],
    estimateCostUsd: () => undefined,
    execute: async (_input, context) => execute(context),
  });
  return map;
}

function scriptedModel(
  decisions: Array<{ type: "tool_call"; toolName: ToolName } | { type: "done" }>
): OrchestratorModel {
  let index = 0;
  return async () => {
    const decision = decisions[Math.min(index, decisions.length - 1)];
    index += 1;
    if (decision.type === "done") return { type: "done", summary: "done", model: "mock" };
    return { type: "tool_call", toolName: decision.toolName, input: {}, model: "mock" };
  };
}

function deps(
  store: FakeStore,
  model: OrchestratorModel,
  registry: ToolRegistry,
  extra: Partial<EngineDeps> = {}
): EngineDeps {
  return {
    workspaceId: "ws1",
    store,
    model,
    registry,
    jobs: { getJob: async () => null },
    resolveOwnerUserId: async () => null,
    resolveAgentDefinition: async () => ({
      role: "creative_director",
      registry,
      systemPrompt: "test creative director",
      loadTurnContext: async () => undefined,
    }),
    ...extra,
  };
}

test("a delegated result parks the run in the domain wait with a running invocation", async () => {
  const store = new FakeStore(runFixture());
  const registry = delegateRegistry((context) => {
    store.childRuns.set(context.actionId!, { id: "child1", status: "queued" });
    return {
      status: "delegated",
      childRunId: "child1",
      sessionId: "session1",
      resumesWhen: "domain_report",
    };
  });
  const model = scriptedModel([{ type: "tool_call", toolName: "delegate_visuals" }]);

  const result = await runOrchestratorToCompletion("root1", deps(store, model, registry));
  assert.equal(result.status, "waiting");
  assert.equal(result.waitReason, "domain");
  assert.equal(store.actions.length, 1);
  assert.equal(store.actions[0].tool, "delegate_visuals");
  assert.equal(store.actions[0].status, "running");
  assert.deepEqual(store.actions[0].jobIds, []);
});

test("resume stays parked in the domain wait while the child run is active", async () => {
  const store = new FakeStore(runFixture({ status: "waiting", waitReason: "domain" }));
  store.actions.push({
    id: "action1",
    tool: "delegate_visuals",
    status: "running",
    params: {},
    outputAssetIds: [],
    jobIds: [],
    createdAt: "t1",
  });
  store.childRuns.set("action1", { id: "child1", status: "running" });
  const model = scriptedModel([{ type: "done" }]);

  const result = await resumeOrchestratorRun("root1", deps(store, model, new Map()));
  assert.equal(result.status, "waiting");
  assert.equal(result.waitReason, "domain");
  assert.equal(store.actions[0].status, "running", "the invocation stays in flight");
});

test("resume proceeds once finalization applied the delegation action", async () => {
  const store = new FakeStore(runFixture({ status: "waiting", waitReason: "domain" }));
  // The finalization transaction marked the delegation applied with the
  // child's report outputs before waking this dispatch.
  store.actions.push({
    id: "action1",
    tool: "delegate_visuals",
    status: "applied",
    params: {},
    outputAssetIds: ["clip_asset"],
    jobIds: [],
    createdAt: "t1",
  });
  store.childRuns.set("action1", { id: "child1", status: "succeeded" });
  const model = scriptedModel([{ type: "done" }]);

  const result = await resumeOrchestratorRun("root1", deps(store, model, new Map()));
  assert.equal(result.status, "succeeded");
  assert.equal(result.waitReason, undefined);
});

for (const [label, domainReport] of [
  [
    "blocked",
    {
      schemaVersion: "DomainReport.v1",
      outcome: {
        outcome: "blocked",
        precondition: { requirement: "narration_track", because: "timing depends on it" },
        requiredDomain: "audio",
        targets: [],
        reason: "Narration is required before the visual timing can continue.",
      },
    },
  ],
  [
    "question",
    {
      schemaVersion: "DomainReport.v1",
      outcome: {
        outcome: "question",
        question: "Use a warm or cool palette?",
        targets: [],
        options: [{ id: "warm", label: "Warm", tradeoff: "cozier" }],
        fingerprint: "palette-v1",
      },
    },
  ],
] as const) {
  test(`resume exposes a ${label} domain report to the root model`, async () => {
    const store = new FakeStore(runFixture({ status: "waiting", waitReason: "domain" }));
    store.actions.push({
      id: "action1",
      tool: "delegate_visuals",
      status: "failed",
      params: {},
      outputAssetIds: [],
      jobIds: [],
      error: {
        schema: "ToolError.v1",
        kind: label === "blocked" ? "precondition_unmet" : "invalid_input",
        message: "Delegated domain needs root attention.",
        recoverable: true,
        domainReport,
      },
      createdAt: "t1",
    });
    let received: unknown[] | undefined;
    const model: OrchestratorModel = async ({ priorResults }) => {
      received = priorResults;
      return { type: "done", summary: "handled", model: "mock" };
    };

    const result = await resumeOrchestratorRun("root1", deps(store, model, new Map()));
    assert.equal(result.status, "succeeded");
    assert.deepEqual(
      (received?.[0] as { error?: { domainReport?: unknown } })?.error?.domainReport,
      domainReport,
      "the complete immutable report survives the action-to-model projection"
    );
  });
}

test("a child that ended without a report fails the invocation recoverably", async () => {
  const store = new FakeStore(runFixture({ status: "waiting", waitReason: "domain" }));
  store.actions.push({
    id: "action1",
    tool: "delegate_visuals",
    status: "running",
    params: {},
    outputAssetIds: [],
    jobIds: [],
    createdAt: "t1",
  });
  store.childRuns.set("action1", { id: "child1", status: "canceled" });
  const model = scriptedModel([{ type: "done" }]);

  const result = await resumeOrchestratorRun("root1", deps(store, model, new Map()));
  assert.equal(result.status, "succeeded", "the model turn runs after reconcile");
  assert.equal(store.actions[0].status, "failed");
  assert.equal(store.actions[0].error?.recoverable, true);
});

test("a never-dispatched delegation fails the invocation recoverably", async () => {
  const store = new FakeStore(runFixture({ status: "waiting", waitReason: "domain" }));
  store.actions.push({
    id: "action1",
    tool: "delegate_visuals",
    status: "running",
    params: {},
    outputAssetIds: [],
    jobIds: [],
    createdAt: "t1",
  });
  // No child run exists for action1 (crash before the dispatch transaction).
  const model = scriptedModel([{ type: "done" }]);

  const result = await resumeOrchestratorRun("root1", deps(store, model, new Map()));
  assert.equal(result.status, "succeeded");
  assert.equal(store.actions[0].status, "failed");
  assert.equal(store.actions[0].error?.recoverable, true);
});
