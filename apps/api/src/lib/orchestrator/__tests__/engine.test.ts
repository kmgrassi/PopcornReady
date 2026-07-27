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
import type { ToolCallResult, ToolError, ToolExecutionContext, ToolName } from "../types";
import type { OrchestratorModel } from "../model";
import type { ToolRegistry } from "../registry";
import { driverToolDefinitionMetadata } from "@/lib/orchestrator-tools/capability-catalog";

// ---------- fakes (no DB, no network) ----------

function runFixture(over: Partial<OrchestratorRun> = {}): OrchestratorRun {
  return {
    id: "run1",
    schemaVersion: "orchestrator_run.v1",
    projectId: "proj1",
    status: "queued",
    inputSummary: "make a 15s video about a skateboarding puppy",
    spentUsd: 0,
    createdAt: "t0",
    updatedAt: "t0",
    ...over,
  };
}

function gateFixture(
  stage: string,
  status: OrchestratorRunGate["status"] = "pending"
): OrchestratorRunGate {
  return {
    id: `gate_${stage}`,
    orchestratorRunId: "run1",
    stage,
    status,
    createdAt: "t0",
    updatedAt: "t0",
  };
}

class FakeStore implements OrchestratorEngineStore {
  run: OrchestratorRun;
  gates: OrchestratorRunGate[];
  actions: RunActionSummary[] = [];

  constructor(run: OrchestratorRun, gates: OrchestratorRunGate[] = []) {
    this.run = run;
    this.gates = gates;
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
    return { ...this.run };
  }
  async listRunGates() {
    return this.gates.map((g) => ({ ...g }));
  }
  async markGateReached(_id: string, stage: string) {
    const g = this.gates.find(
      (x) => x.stage === stage && (x.status === "pending" || x.status === "rejected")
    );
    if (!g) return null;
    g.status = "reached";
    return { ...g };
  }
  async listRunActions() {
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
    const action = this.actions.find((a) => a.id === actionId);
    if (!action) return;
    action.status = patch.status;
    if (patch.jobIds) action.jobIds = patch.jobIds;
    if (patch.outputAssetIds) action.outputAssetIds = patch.outputAssetIds;
    if (patch.error) action.error = patch.error;
  }
}

function fakeRegistry(
  handlers: Partial<Record<ToolName, (context: ToolExecutionContext) => ToolCallResult>>,
  estimates: Partial<Record<ToolName, number>> = {}
): ToolRegistry {
  const map: ToolRegistry = new Map();
  for (const [name, fn] of Object.entries(handlers)) {
    const toolName = name as ToolName;
    map.set(name as ToolName, {
      ...driverToolDefinitionMetadata(toolName),
      description: "",
      inputSchema: {},
      outputSchema: {},
      requiredResourceIds: [],
      estimateCostUsd: () => estimates[toolName],
      execute: async (_input, context) => fn!(context),
    });
  }
  return map;
}

// A model that replays a fixed list of decisions in order.
function scriptedModel(
  decisions: Array<
    | { type: "tool_call"; toolName: ToolName; input?: Record<string, unknown> }
    | { type: "done" }
  >
): { model: OrchestratorModel; calls: unknown[] } {
  const calls: unknown[] = [];
  let i = 0;
  const model: OrchestratorModel = async (input) => {
    calls.push(input.priorResults);
    const d = decisions[Math.min(i, decisions.length - 1)];
    i += 1;
    if (d.type === "done") return { type: "done", summary: "done", model: "mock" };
    return { type: "tool_call", toolName: d.toolName, input: d.input ?? {}, model: "mock" };
  };
  return { model, calls };
}

function deps(store: FakeStore, model: OrchestratorModel, registry: ToolRegistry, extra: Partial<EngineDeps> = {}): EngineDeps {
  // No-op owner lookup keeps the fake-store loop DB-free (no Supabase env needed).
  return {
    workspaceId: "ws1",
    store,
    model,
    registry,
    jobs: { getJob: async () => null },
    resolveOwnerUserId: async () => null,
    ...extra,
  };
}

const ok = (resourceIds: string[] = [], costUsd?: number): ToolCallResult => ({
  status: "succeeded",
  resourceIds,
  ...(costUsd != null ? { costUsd } : {}),
});

// ---------- tests ----------

test("drives tool→tool→done and persists one action per executed tool", async () => {
  const store = new FakeStore(runFixture());
  const { model } = scriptedModel([
    { type: "tool_call", toolName: "create_or_load_brief" },
    { type: "tool_call", toolName: "plan_shots" },
    { type: "done" },
  ]);
  const registry = fakeRegistry({
    create_or_load_brief: () => ok(["asset_brief"]),
    plan_shots: () => ok([]),
  });

  const run = await runOrchestratorToCompletion("run1", deps(store, model, registry));

  assert.equal(run.status, "succeeded");
  assert.equal(store.actions.length, 2);
  assert.deepEqual(
    store.actions.map((a) => [a.tool, a.status]),
    [
      ["create_or_load_brief", "applied"],
      ["plan_shots", "applied"],
    ]
  );
});

test("injects the server-owned wrapper context into each tool execution", async () => {
  const store = new FakeStore(runFixture());
  const { model } = scriptedModel([
    { type: "tool_call", toolName: "plan_shots", input: { goal: "do not carry ids" } },
    { type: "done" },
  ]);
  let seenContext: ToolExecutionContext | undefined;
  const registry = fakeRegistry({
    plan_shots: (context) => {
      seenContext = context;
      return ok(["asset_plan"]);
    },
  });

  await runOrchestratorToCompletion(
    "run1",
    deps(store, model, registry, {
      actorId: "user1",
      agentId: "agent1",
      messageId: "msg1",
      requestId: "req1",
      metadata: { entrypoint: "prompt" },
    })
  );

  assert.equal(store.actions[0].params.messageId, undefined);
  assert.equal(seenContext?.workspaceId, "ws1");
  assert.equal(seenContext?.projectId, "proj1");
  assert.equal(seenContext?.orchestratorRunId, "run1");
  assert.equal(seenContext?.actorId, "user1");
  assert.equal(seenContext?.agentId, "agent1");
  assert.equal(seenContext?.messageId, "msg1");
  assert.equal(seenContext?.requestId, "req1");
  assert.deepEqual(seenContext?.metadata, { entrypoint: "prompt" });
  assert.match(seenContext?.toolCallId ?? "", /^[0-9a-f-]{36}$/);
  assert.equal(seenContext?.toolCallId, store.actions[0]?.id);
  assert.equal(seenContext?.actionId, store.actions[0]?.id);
});

test("persists the canonical running action before invoking a mutating tool", async () => {
  const store = new FakeStore(runFixture());
  const { model } = scriptedModel([
    { type: "tool_call", toolName: "plan_shots" },
    { type: "done" },
  ]);
  let actionAtExecution: RunActionSummary | undefined;
  const registry = fakeRegistry({
    plan_shots: (context) => {
      const action = store.actions.find((candidate) => candidate.id === context.actionId);
      actionAtExecution = action ? { ...action } : undefined;
      return ok(["asset_plan"]);
    },
  });

  await runOrchestratorToCompletion("run1", deps(store, model, registry));

  assert.equal(actionAtExecution?.status, "running");
  assert.equal(store.actions.length, 1);
  assert.equal(store.actions[0]?.status, "applied");
  assert.equal(store.actions[0]?.outputAssetIds[0], "asset_plan");
});

test("finalizes a reserved action when preflight estimation throws", async () => {
  const store = new FakeStore(runFixture());
  const { model } = scriptedModel([{ type: "tool_call", toolName: "plan_shots" }]);
  const registry = fakeRegistry({ plan_shots: () => ok() });
  const definition = registry.get("plan_shots")!;
  definition.estimateCostUsd = async () => {
    throw new Error("invalid estimated input");
  };

  await assert.rejects(
    () => runOrchestratorToCompletion("run1", deps(store, model, registry)),
    /invalid estimated input/
  );

  assert.equal(store.actions.length, 1);
  assert.equal(store.actions[0]?.status, "failed");
  assert.match(store.actions[0]?.error?.message as string, /invalid estimated input/);
});

test("reconstructs uploaded-footage selected assets from persisted run summary", async () => {
  const store = new FakeStore(
    runFixture({
      inputSummary:
        "Make a montage\nbriefVersionId=brief_1\nselectedAssetIds=upload_5,upload_2,upload_4",
    })
  );
  const { model } = scriptedModel([
    { type: "tool_call", toolName: "assemble_timeline", input: {} },
    { type: "done" },
  ]);
  let seenContext: ToolExecutionContext | undefined;
  const registry = fakeRegistry({
    assemble_timeline: (context) => {
      seenContext = context;
      return ok(["timeline_1"]);
    },
  });

  await runOrchestratorToCompletion("run1", deps(store, model, registry));

  assert.deepEqual(seenContext?.metadata, {
    entrypoint: "uploaded-footage",
    assetIds: ["upload_5", "upload_2", "upload_4"],
  });
});

test("reconstructs priorResults from persisted actions for each model turn", async () => {
  const store = new FakeStore(runFixture());
  const { model, calls } = scriptedModel([
    { type: "tool_call", toolName: "create_or_load_brief" },
    { type: "done" },
  ]);
  const registry = fakeRegistry({ create_or_load_brief: () => ok(["asset_brief"]) });

  await runOrchestratorToCompletion("run1", deps(store, model, registry));

  // First turn sees no prior actions; the second (which returns done) sees the brief.
  assert.deepEqual(calls[0], []);
  assert.deepEqual(calls[1], [
    { tool: "create_or_load_brief", status: "applied", outputAssetIds: ["asset_brief"] },
  ]);
});

test("threads board feedback target context into the next model turn", async () => {
  const store = new FakeStore(runFixture());
  store.actions.push({
    id: "feedback_1",
    tool: "board_feedback",
    status: "applied",
    params: {
      schemaVersion: "board_revision_request.v1",
      message: "Make this tile feel colder.",
      target: { scope: "tile", beatId: "beat_1", keyframeAssetId: "asset_1" },
    },
    outputAssetIds: [],
    jobIds: [],
    createdAt: "t1",
  });
  const { model, calls } = scriptedModel([{ type: "done" }]);

  await runOrchestratorToCompletion("run1", deps(store, model, fakeRegistry({})));

  assert.deepEqual(calls[0], [
    {
      tool: "board_feedback",
      status: "applied",
      outputAssetIds: [],
      request: {
        schemaVersion: "board_revision_request.v1",
        message: "Make this tile feel colder.",
        target: { scope: "tile", beatId: "beat_1", keyframeAssetId: "asset_1" },
      },
    },
  ]);
});

test("threads a failed action's recovery guidance into the next model turn", async () => {
  const store = new FakeStore(runFixture());
  const { model, calls } = scriptedModel([
    { type: "tool_call", toolName: "plan_shots" },
    { type: "tool_call", toolName: "create_or_load_brief" },
    { type: "done" },
  ]);
  const planShotsError: ToolError = {
    kind: "precondition_unmet",
    message: "plan_shots needs a project brief before it can plan shots.",
    recoverable: true,
    unmetRequirements: [
      {
        requirement: "brief",
        because: "The plan is derived from the project's brief.",
        satisfyWith: { tool: "create_or_load_brief", inputHint: {} },
      },
    ],
    suggestedNextTools: [{ tool: "create_or_load_brief", inputHint: {} }],
  };
  const registry = fakeRegistry({
    plan_shots: () => ({ status: "failed", error: planShotsError }),
    create_or_load_brief: () => ok(["asset_brief"]),
  });

  await runOrchestratorToCompletion("run1", deps(store, model, registry));

  // The turn after plan_shots failed must carry WHY it failed and which tool to
  // call next, so the model recovers instead of blindly retrying the failed tool.
  assert.deepEqual(calls[1], [
    { tool: "plan_shots", status: "failed", outputAssetIds: [], error: planShotsError },
  ]);
});

test("parks on an accepted async job, then resumes to completion when the job succeeds", async () => {
  const store = new FakeStore(runFixture());
  const { model } = scriptedModel([
    { type: "tool_call", toolName: "generate_keyframe" },
    { type: "done" },
  ]);
  const registry = fakeRegistry({
    generate_keyframe: () => ({ status: "accepted", jobId: "job1", resumesWhen: "job_terminal" }),
  });

  const parked = await runOrchestratorToCompletion("run1", deps(store, model, registry));
  assert.equal(parked.status, "waiting");
  assert.equal(store.actions.length, 1);
  assert.deepEqual([store.actions[0].status, store.actions[0].jobIds], ["running", ["job1"]]);

  const resumed = await resumeOrchestratorRun(
    "run1",
    deps(store, model, registry, {
      jobs: { getJob: async () => ({ status: "succeeded", result: { assetIds: ["tile_1", "tile_2"] } }) },
    })
  );
  assert.equal(resumed.status, "succeeded");
  // the parking action is finalized with the assets its job produced
  assert.equal(store.actions[0].status, "applied");
  assert.deepEqual(store.actions[0].outputAssetIds, ["tile_1", "tile_2"]);
});

test("continues when an async job finishes before the initial park completes", async () => {
  const store = new FakeStore(runFixture());
  const { model } = scriptedModel([
    { type: "tool_call", toolName: "generate_storyboard" },
    { type: "tool_call", toolName: "generate_keyframe" },
    { type: "done" },
  ]);
  const registry = fakeRegistry({
    generate_storyboard: () => ({ status: "accepted", jobId: "job1", resumesWhen: "job_terminal" }),
    generate_keyframe: () => ok(["keyframe_1"]),
  });

  const run = await runOrchestratorToCompletion(
    "run1",
    deps(store, model, registry, {
      jobs: { getJob: async () => ({ status: "succeeded", result: { assetIds: ["tile_1"] } }) },
    })
  );

  assert.equal(run.status, "succeeded");
  assert.deepEqual(
    store.actions.map((action) => [action.tool, action.status, action.outputAssetIds]),
    [
      ["generate_storyboard", "applied", ["tile_1"]],
      ["generate_keyframe", "applied", ["keyframe_1"]],
    ]
  );
});

test("does not start a concurrent loop when an async completion arrives while the run is active", async () => {
  const store = new FakeStore(runFixture({ status: "running" }));
  const { model } = scriptedModel([{ type: "tool_call", toolName: "generate_keyframe" }]);
  const registry = fakeRegistry({ generate_keyframe: () => ok(["keyframe_1"]) });

  const result = await resumeOrchestratorRun("run1", deps(store, model, registry));

  assert.equal(result.status, "running");
  assert.equal(store.actions.length, 0, "only the owning loop may execute the next tool");
});

test("only one caller claims a parked async job for resume", async () => {
  const store = new FakeStore(runFixture());
  const { model } = scriptedModel([
    { type: "tool_call", toolName: "generate_storyboard" },
    { type: "tool_call", toolName: "generate_keyframe" },
    { type: "done" },
  ]);
  const registry = fakeRegistry({
    generate_storyboard: () => ({ status: "accepted", jobId: "job1", resumesWhen: "job_terminal" }),
    generate_keyframe: () => ok(["keyframe_1"]),
  });
  await runOrchestratorToCompletion("run1", deps(store, model, registry));
  const completionDeps = deps(store, model, registry, {
    jobs: { getJob: async () => ({ status: "succeeded", result: { assetIds: ["tile_1"] } }) },
  });

  await Promise.all([
    resumeOrchestratorRun("run1", completionDeps),
    resumeOrchestratorRun("run1", completionDeps),
  ]);

  assert.deepEqual(
    store.actions.map((action) => action.tool),
    ["generate_storyboard", "generate_keyframe"]
  );
});

test("recovery reconciles a claimed async job before it starts another model turn", async () => {
  const store = new FakeStore(runFixture({ status: "running" }));
  store.actions.push({
    id: "a0",
    tool: "generate_storyboard",
    status: "running",
    params: {},
    outputAssetIds: [],
    jobIds: ["job1"],
    createdAt: "t1",
  });
  const { model } = scriptedModel([
    { type: "tool_call", toolName: "generate_keyframe" },
    { type: "done" },
  ]);
  const registry = fakeRegistry({ generate_keyframe: () => ok(["keyframe_1"]) });

  const run = await runOrchestratorToCompletion(
    "run1",
    deps(store, model, registry, {
      jobs: { getJob: async () => ({ status: "succeeded", result: { assetIds: ["tile_1"] } }) },
    })
  );

  assert.equal(run.status, "succeeded");
  assert.deepEqual(
    store.actions.map((action) => [action.tool, action.status, action.outputAssetIds]),
    [
      ["generate_storyboard", "applied", ["tile_1"]],
      ["generate_keyframe", "applied", ["keyframe_1"]],
    ]
  );
});

test("finishes after an after-gate async job succeeds", async () => {
  const store = new FakeStore(runFixture(), [gateFixture("after:generate_keyframe")]);
  const { model } = scriptedModel([
    { type: "tool_call", toolName: "generate_keyframe" },
    { type: "tool_call", toolName: "generate_clip" },
    { type: "done" },
  ]);
  const registry = fakeRegistry({
    generate_keyframe: () => ({ status: "accepted", jobId: "job1", resumesWhen: "job_terminal" }),
    generate_clip: () => ok(["clip_1"]),
  });

  const parked = await runOrchestratorToCompletion("run1", deps(store, model, registry));
  assert.equal(parked.status, "waiting");
  assert.equal(store.gates[0].status, "pending");

  const stopped = await resumeOrchestratorRun(
    "run1",
    deps(store, model, registry, {
      jobs: { getJob: async () => ({ status: "succeeded", result: { assetIds: ["keyframe_1"] } }) },
    })
  );

  assert.equal(stopped.status, "succeeded");
  assert.equal(store.gates[0].status, "reached");
  assert.equal(store.actions.length, 1, "next tool must not run after the stop-after tool");
  assert.equal(store.actions[0].status, "applied");
  assert.deepEqual(store.actions[0].outputAssetIds, ["keyframe_1"]);
});

test("after-gates do not pause before the requested tool executes", async () => {
  const store = new FakeStore(runFixture(), [gateFixture("after:create_or_load_brief")]);
  const { model } = scriptedModel([
    { type: "tool_call", toolName: "create_or_load_brief" },
    { type: "tool_call", toolName: "plan_shots" },
  ]);
  const registry = fakeRegistry({
    create_or_load_brief: () => ok(["asset_brief"]),
    plan_shots: () => ok(["asset_plan"]),
  });

  const stopped = await runOrchestratorToCompletion("run1", deps(store, model, registry));

  assert.equal(stopped.status, "succeeded");
  assert.equal(store.gates[0].status, "reached");
  assert.deepEqual(
    store.actions.map((action) => action.tool),
    ["create_or_load_brief"]
  );
});

test("continues from a reviewed storyboard without rerunning its planning pass", async () => {
  const store = new FakeStore(runFixture(), [gateFixture("after:generate_storyboard")]);
  const { model } = scriptedModel([
    { type: "tool_call", toolName: "generate_storyboard" },
    { type: "tool_call", toolName: "generate_keyframe" },
    { type: "done" },
  ]);
  const registry = fakeRegistry({
    generate_storyboard: () => ok(["storyboard_1"]),
    generate_keyframe: () => ok(["keyframe_1"]),
  });

  const storyboardPass = await runOrchestratorToCompletion("run1", deps(store, model, registry));
  assert.equal(storyboardPass.status, "succeeded");
  assert.equal(store.gates[0].status, "reached");
  assert.deepEqual(store.actions.map((action) => action.tool), ["generate_storyboard"]);

  // This mirrors the approval route: resolve the post-tool gate and reopen the
  // completed planning pass before the recovery worker resumes it.
  store.gates[0].status = "approved";
  store.run = { ...store.run, status: "waiting", completedAt: undefined };
  const productionPass = await resumeOrchestratorRun("run1", deps(store, model, registry));

  assert.equal(productionPass.status, "succeeded");
  assert.deepEqual(store.actions.map((action) => action.tool), [
    "generate_storyboard",
    "generate_keyframe",
  ]);
});

test("rejected storyboard review regenerates the board and returns to review", async () => {
  const store = new FakeStore(runFixture(), [gateFixture("after:generate_storyboard")]);
  const model: OrchestratorModel = async ({ priorResults, registry }) => {
    if ((priorResults as Array<{ tool: string }>).length === 0) {
      return { type: "tool_call", toolName: "generate_storyboard", input: {}, model: "mock" };
    }
    return registry.has("generate_keyframe")
      ? { type: "tool_call", toolName: "generate_keyframe", input: {}, model: "mock" }
      : { type: "tool_call", toolName: "generate_storyboard", input: {}, model: "mock" };
  };
  const registry = fakeRegistry({
    generate_storyboard: () => ok(["storyboard_1"]),
    generate_keyframe: () => ok(["keyframe_1"]),
  });

  await runOrchestratorToCompletion("run1", deps(store, model, registry));
  store.gates[0].status = "rejected";
  store.run = { ...store.run, status: "waiting", completedAt: undefined };

  const regenerated = await resumeOrchestratorRun("run1", deps(store, model, registry));

  assert.equal(regenerated.status, "succeeded");
  assert.equal(store.gates[0].status, "reached");
  assert.deepEqual(store.actions.map((action) => action.tool), [
    "generate_storyboard",
    "generate_storyboard",
  ]);
});

test("stays parked when the resume job is not yet terminal", async () => {
  const store = new FakeStore(runFixture());
  const { model } = scriptedModel([{ type: "tool_call", toolName: "generate_keyframe" }]);
  const registry = fakeRegistry({
    generate_keyframe: () => ({ status: "accepted", jobId: "job1", resumesWhen: "job_terminal" }),
  });
  await runOrchestratorToCompletion("run1", deps(store, model, registry));

  const stillParked = await resumeOrchestratorRun(
    "run1",
    deps(store, model, registry, { jobs: { getJob: async () => ({ status: "running" }) } })
  );
  assert.equal(stillParked.status, "waiting");
});

test("preserves a failed parking job's reference-storage error", async () => {
  const store = new FakeStore(runFixture());
  const { model, calls } = scriptedModel([
    { type: "tool_call", toolName: "generate_keyframe" },
    { type: "done" },
  ]);
  const registry = fakeRegistry({
    generate_keyframe: () => ({
      status: "accepted",
      jobId: "job1",
      resumesWhen: "job_terminal",
    }),
  });
  await runOrchestratorToCompletion("run1", deps(store, model, registry));

  const recovered = await resumeOrchestratorRun(
    "run1",
    deps(store, model, registry, {
      jobs: {
        getJob: async () => ({
          status: "failed",
          error: {
            code: "object_not_found",
            message: "Stored bytes for reference asset asset_storyboard could not be read.",
          },
        }),
      },
    })
  );

  assert.equal(recovered.status, "succeeded");
  assert.equal(store.actions[0].status, "failed");
  assert.equal(store.actions[0].error?.kind, "precondition_unmet");
  assert.match((store.actions[0].error?.message as string) ?? "", /asset_storyboard/);
  const priorFailure = (calls[1] as Array<{ error?: ToolError }>)[0];
  assert.equal(priorFailure.error?.kind, "precondition_unmet");
  assert.equal(priorFailure.error?.recoverable, true);
  assert.match(priorFailure.error?.message ?? "", /asset_storyboard/);
  assert.equal(priorFailure.error?.unmetRequirements?.[0]?.requirement, "ready_reference_asset");
});

test("preserves a true failed parking job as a provider failure", async () => {
  const store = new FakeStore(runFixture());
  const { model } = scriptedModel([
    { type: "tool_call", toolName: "generate_keyframe" },
  ]);
  const registry = fakeRegistry({
    generate_keyframe: () => ({
      status: "accepted",
      jobId: "job1",
      resumesWhen: "job_terminal",
    }),
  });
  await runOrchestratorToCompletion("run1", deps(store, model, registry));

  const failed = await resumeOrchestratorRun(
    "run1",
    deps(store, model, registry, {
      jobs: {
        getJob: async () => ({
          status: "failed",
          error: {
            code: "job_failed",
            message:
              "Runway generation failed with Bearer secret-provider-token-1234567890.",
          },
        }),
      },
    })
  );

  assert.equal((failed.error as { kind?: string }).kind, "provider_failed");
  assert.equal(
    (failed.error as { message?: string }).message,
    "Runway generation failed with [REDACTED]"
  );
});

test("classifies a failed parking job's storage infrastructure error as recoverable", async () => {
  const store = new FakeStore(runFixture());
  const { model, calls } = scriptedModel([
    { type: "tool_call", toolName: "generate_keyframe" },
    { type: "tool_call", toolName: "generate_keyframe", input: { retry: true } },
  ]);
  let invocation = 0;
  const registry = fakeRegistry({
    generate_keyframe: () => {
      invocation += 1;
      return {
        status: "accepted",
        jobId: `job${invocation}`,
        resumesWhen: "job_terminal",
      };
    },
  });
  await runOrchestratorToCompletion("run1", deps(store, model, registry));

  const retried = await resumeOrchestratorRun(
    "run1",
    deps(store, model, registry, {
      jobs: {
        getJob: async (jobId) =>
          jobId === "job1"
            ? {
                status: "failed",
                error: {
                  code: "storage_error",
                  message: "Reference storage failed while reading asset asset_storyboard.",
                },
              }
            : { status: "running" },
      },
    })
  );

  assert.equal(retried.status, "waiting");
  assert.equal(retried.error, undefined);
  assert.deepEqual(
    store.actions.map((action) => [action.status, action.jobIds]),
    [
      ["failed", ["job1"]],
      ["running", ["job2"]],
    ]
  );
  assert.equal(store.actions[0].error?.kind, "storage_error");
  assert.equal(store.actions[0].error?.recoverable, true);
  assert.deepEqual(
    store.actions[0].error?.suggestedNextTools,
    [{ tool: "generate_keyframe", inputHint: { retry: true } }]
  );
  assert.deepEqual(calls[1], [
    {
      tool: "generate_keyframe",
      status: "failed",
      outputAssetIds: [],
      error: {
        kind: "storage_error",
        message: "Reference storage failed while reading asset asset_storyboard.",
        recoverable: true,
        suggestedNextTools: [{ tool: "generate_keyframe", inputHint: { retry: true } }],
      },
    },
  ]);
});

test("stops retrying after repeated recoverable async storage failures", async () => {
  const store = new FakeStore(runFixture());
  const { model } = scriptedModel([
    { type: "tool_call", toolName: "generate_keyframe" },
    { type: "tool_call", toolName: "generate_keyframe", input: { retry: true } },
    { type: "tool_call", toolName: "generate_keyframe", input: { retry: true } },
  ]);
  let invocation = 0;
  const registry = fakeRegistry({
    generate_keyframe: () => {
      invocation += 1;
      return {
        status: "accepted",
        jobId: `job${invocation}`,
        resumesWhen: "job_terminal",
      };
    },
  });
  const failedStorageJob = {
    status: "failed",
    error: {
      code: "storage_error",
      message: "Reference storage is still unavailable.",
    },
  };

  const failed = await runOrchestratorToCompletion(
    "run1",
    deps(store, model, registry, {
      jobs: { getJob: async () => failedStorageJob },
    })
  );

  assert.equal(failed.status, "failed");
  assert.equal(store.actions.length, 3, "the engine must not schedule a fourth async job");
  assert.deepEqual(
    store.actions.map((action) => action.status),
    ["failed", "failed", "failed"]
  );
  assert.equal(store.actions[2].error?.kind, "storage_error");
  assert.equal(store.actions[2].error?.recoverable, false);
  assert.deepEqual(store.actions[2].error?.details, {
    code: "storage_error",
    jobId: "job3",
    asyncFailureCount: 3,
    asyncFailureLimit: 3,
  });
});

test("resets the async retry streak when the same tool fails with a different kind", async () => {
  const store = new FakeStore(runFixture({ status: "waiting" }));
  store.actions.push(
    {
      id: "a0",
      tool: "generate_keyframe",
      status: "failed",
      params: {},
      outputAssetIds: [],
      jobIds: ["job1"],
      error: { kind: "storage_error", recoverable: true },
      createdAt: "t1",
    },
    {
      id: "a1",
      tool: "generate_keyframe",
      status: "failed",
      params: {},
      outputAssetIds: [],
      jobIds: ["job2"],
      error: { kind: "precondition_unmet", recoverable: true },
      createdAt: "t2",
    },
    {
      id: "a2",
      tool: "generate_keyframe",
      status: "running",
      params: {},
      outputAssetIds: [],
      jobIds: ["job3"],
      createdAt: "t3",
    }
  );
  const { model } = scriptedModel([{ type: "done" }]);

  const recovered = await resumeOrchestratorRun(
    "run1",
    deps(store, model, fakeRegistry({}), {
      jobs: {
        getJob: async () => ({
          status: "failed",
          error: { code: "storage_error", message: "Storage is temporarily unavailable." },
        }),
      },
    })
  );

  assert.equal(recovered.status, "succeeded");
  assert.equal(store.actions[2].status, "failed");
  assert.equal(store.actions[2].error?.kind, "storage_error");
  assert.equal(store.actions[2].error?.recoverable, true);
});

test("keeps a run parked when a legacy action references an unknown job id", async () => {
  const store = new FakeStore(runFixture());
  const { model } = scriptedModel([{ type: "tool_call", toolName: "generate_keyframe" }]);
  const registry = fakeRegistry({
    generate_keyframe: () => ({ status: "accepted", jobId: "legacy_job", resumesWhen: "job_terminal" }),
  });
  await runOrchestratorToCompletion("run1", deps(store, model, registry));

  const stillParked = await resumeOrchestratorRun(
    "run1",
    deps(store, model, registry, { jobs: { getJob: async () => null } })
  );
  assert.equal(stillParked.status, "waiting");
  assert.equal(store.actions[0].status, "running");
});

test("parks on an approval gate and persists preview artifacts on the action", async () => {
  const store = new FakeStore(runFixture());
  const { model } = scriptedModel([
    {
      type: "tool_call",
      toolName: "request_approval",
      input: { step: "export_video", previewArtifactIds: ["preview_1"] },
    },
  ]);
  const registry = fakeRegistry({
    request_approval: () => ({
      status: "waiting_for_approval",
      gateId: "gate_export_video",
      resumesWhen: "approval_terminal",
      previewArtifactIds: ["preview_1"],
    }),
  });

  const parked = await runOrchestratorToCompletion("run1", deps(store, model, registry));

  assert.equal(parked.status, "waiting");
  assert.equal(store.actions.length, 1);
  assert.equal(store.actions[0].tool, "request_approval");
  assert.equal(store.actions[0].status, "running");
  assert.deepEqual(store.actions[0].outputAssetIds, ["preview_1"]);
});

test("parks before a gated stage and resumes once the gate is approved", async () => {
  const store = new FakeStore(runFixture(), [gateFixture("create_or_load_brief")]);
  // Model wants the brief until one exists, then it's done.
  const model: OrchestratorModel = async ({ priorResults }) => {
    const hasBrief = (priorResults as Array<{ tool: string }>).some(
      (r) => r.tool === "create_or_load_brief"
    );
    return hasBrief
      ? { type: "done", summary: "done", model: "mock" }
      : { type: "tool_call", toolName: "create_or_load_brief", input: {}, model: "mock" };
  };
  const registry = fakeRegistry({ create_or_load_brief: () => ok(["asset_brief"]) });

  const parked = await runOrchestratorToCompletion("run1", deps(store, model, registry));
  assert.equal(parked.status, "waiting");
  assert.equal(store.actions.length, 0, "tool must not execute before approval");
  assert.equal(store.gates[0].status, "reached");

  // User approves the gate, then the run resumes.
  store.gates[0].status = "approved";
  const resumed = await resumeOrchestratorRun("run1", deps(store, model, registry));
  assert.equal(resumed.status, "succeeded");
  assert.equal(store.actions.length, 1);
});

test("uses latest gate state after the model turn before parking", async () => {
  const store = new FakeStore(runFixture(), [
    gateFixture("create_or_load_brief", "reached"),
  ]);
  const model: OrchestratorModel = async ({ priorResults }) => {
    const hasBrief = (priorResults as Array<{ tool: string }>).some(
      (r) => r.tool === "create_or_load_brief"
    );
    if (hasBrief) return { type: "done", summary: "done", model: "mock" };
    store.gates[0].status = "approved";
    return { type: "tool_call", toolName: "create_or_load_brief", input: {}, model: "mock" };
  };
  const registry = fakeRegistry({ create_or_load_brief: () => ok(["asset_brief"]) });

  const run = await runOrchestratorToCompletion("run1", deps(store, model, registry));

  assert.equal(run.status, "succeeded");
  assert.equal(store.actions.length, 1);
  assert.equal(store.actions[0].tool, "create_or_load_brief");
  assert.equal(store.actions[0].status, "applied");
});

test("a rejected gate regenerates the gated stage and parks for review again", async () => {
  const store = new FakeStore(runFixture(), [gateFixture("create_or_load_brief", "rejected")]);
  const seenRegistryKeys: string[][] = [];
  const model: OrchestratorModel = async ({ registry }) => {
    seenRegistryKeys.push(Array.from(registry.keys()));
    return { type: "tool_call", toolName: "create_or_load_brief", input: {}, model: "mock" };
  };
  const registry = fakeRegistry({
    create_or_load_brief: () => ok(["asset_brief"]),
    plan_shots: () => ok(["asset_plan"]),
  });

  const run = await runOrchestratorToCompletion("run1", deps(store, model, registry));

  assert.equal(run.status, "waiting");
  assert.deepEqual(seenRegistryKeys, [["create_or_load_brief"]]);
  assert.equal(store.gates[0].status, "reached");
  assert.equal(store.actions.length, 1);
  assert.equal(store.actions[0].tool, "create_or_load_brief");
  assert.equal(store.actions[0].status, "applied");
  assert.deepEqual(store.actions[0].outputAssetIds, ["asset_brief"]);
  assert.equal(store.actions[0].error, undefined);
});

test("a rejected gate prevents a later-stage tool from executing", async () => {
  const store = new FakeStore(runFixture(), [gateFixture("create_or_load_brief", "rejected")]);
  const { model } = scriptedModel([
    { type: "tool_call", toolName: "plan_shots" },
  ]);
  let planShotsExecuted = false;
  const registry = fakeRegistry({
    create_or_load_brief: () => ok(["asset_brief"]),
    plan_shots: () => {
      planShotsExecuted = true;
      return ok(["asset_plan"]);
    },
  });

  const run = await runOrchestratorToCompletion("run1", deps(store, model, registry));

  assert.equal(run.status, "failed");
  assert.equal(planShotsExecuted, false);
  assert.equal(store.gates[0].status, "rejected");
  assert.equal(store.actions.length, 1);
  assert.equal(store.actions[0].tool, "plan_shots");
  assert.equal(store.actions[0].status, "failed");
  assert.match((store.actions[0].error as { message?: string }).message ?? "", /Unknown orchestrator tool/);
});

test("an async rejected gate parks on the job, then parks for review after job success", async () => {
  const store = new FakeStore(runFixture(), [gateFixture("generate_keyframe", "rejected")]);
  const { model } = scriptedModel([
    { type: "tool_call", toolName: "generate_keyframe" },
    { type: "done" },
  ]);
  const registry = fakeRegistry({
    generate_keyframe: () => ({ status: "accepted", jobId: "job1", resumesWhen: "job_terminal" }),
  });

  const parkedOnJob = await runOrchestratorToCompletion("run1", deps(store, model, registry));
  assert.equal(parkedOnJob.status, "waiting");
  assert.equal(store.gates[0].status, "rejected", "review gate waits for the regenerated job");
  assert.deepEqual([store.actions[0].tool, store.actions[0].status, store.actions[0].jobIds], [
    "generate_keyframe",
    "running",
    ["job1"],
  ]);

  const parkedForReview = await resumeOrchestratorRun(
    "run1",
    deps(store, model, registry, {
      jobs: { getJob: async () => ({ status: "succeeded", result: { assetIds: ["keyframe_1"] } }) },
    })
  );

  assert.equal(parkedForReview.status, "waiting");
  assert.equal(store.gates[0].status, "reached");
  assert.equal(store.actions[0].status, "applied");
  assert.deepEqual(store.actions[0].outputAssetIds, ["keyframe_1"]);
});

test("a pending stop gate parks for review after an async job succeeds", async () => {
  const store = new FakeStore(runFixture());
  const { model } = scriptedModel([
    { type: "tool_call", toolName: "generate_keyframe" },
    { type: "tool_call", toolName: "generate_clip" },
    { type: "done" },
  ]);
  const registry = fakeRegistry({
    generate_keyframe: () => ({ status: "accepted", jobId: "job1", resumesWhen: "job_terminal" }),
    generate_clip: () => ok(["clip_1"]),
  });

  const parkedOnJob = await runOrchestratorToCompletion("run1", deps(store, model, registry));
  assert.equal(parkedOnJob.status, "waiting");
  store.gates.push(gateFixture("generate_keyframe", "pending"));

  const parkedForReview = await resumeOrchestratorRun(
    "run1",
    deps(store, model, registry, {
      jobs: { getJob: async () => ({ status: "succeeded", result: { assetIds: ["keyframe_1"] } }) },
    })
  );

  assert.equal(parkedForReview.status, "waiting");
  assert.equal(store.gates[0].status, "reached");
  assert.equal(store.actions.length, 1, "next tool must not run after the pending stop gate");
  assert.equal(store.actions[0].status, "applied");
  assert.deepEqual(store.actions[0].outputAssetIds, ["keyframe_1"]);
});

test("a stop request after a sync step prevents the live loop from starting the next tool", async () => {
  const store = new FakeStore(runFixture());
  const { model } = scriptedModel([
    { type: "tool_call", toolName: "create_or_load_brief" },
    { type: "tool_call", toolName: "plan_shots" },
    { type: "done" },
  ]);
  let planShotsExecuted = false;
  const registry = fakeRegistry({
    create_or_load_brief: () => {
      store.run = { ...store.run, status: "waiting" };
      store.gates.push(gateFixture("create_or_load_brief", "reached"));
      return ok(["asset_brief"]);
    },
    plan_shots: () => {
      planShotsExecuted = true;
      return ok(["asset_plan"]);
    },
  });

  const stopped = await runOrchestratorToCompletion("run1", deps(store, model, registry));

  assert.equal(stopped.status, "waiting");
  assert.equal(planShotsExecuted, false);
  assert.deepEqual(
    store.actions.map((action) => action.tool),
    ["create_or_load_brief"]
  );
});

test("a model turn timeout marks the run failed instead of leaving it running", async () => {
  const store = new FakeStore(runFixture());
  let releaseModel: (() => void) | undefined;
  const model: OrchestratorModel = async () => {
    await new Promise<void>((resolve) => {
      releaseModel = resolve;
    });
    return { type: "done", summary: "too late", model: "mock" };
  };

  const run = await runOrchestratorToCompletion(
    "run1",
    deps(store, model, fakeRegistry({}), { modelTurnTimeoutMs: 5 })
  );
  releaseModel?.();

  assert.equal(run.status, "failed");
  assert.equal((run.error as { kind?: string }).kind, "timeout");
  assert.match((run.error as { message?: string }).message ?? "", /model turn exceeded 5ms/);
  assert.equal(store.actions.length, 0);
});

test("a tool that throws marks the run failed with a persisted error", async () => {
  const store = new FakeStore(runFixture());
  const { model } = scriptedModel([{ type: "tool_call", toolName: "plan_shots" }]);
  const registry = fakeRegistry({
    plan_shots: () => {
      throw new Error("database is down");
    },
  });

  const run = await runOrchestratorToCompletion("run1", deps(store, model, registry));

  assert.equal(run.status, "failed", "an exception must not leave the run stuck running");
  assert.match((run.error as { message?: string }).message ?? "", /database is down/);
  assert.equal(store.actions.length, 1);
  assert.equal(store.actions[0].status, "failed");
});

test("a recoverable failure keeps the run going; an unrecoverable one fails it", async () => {
  const recoverableStore = new FakeStore(runFixture());
  const { model: recModel } = scriptedModel([
    { type: "tool_call", toolName: "plan_shots" },
    { type: "done" },
  ]);
  const recoverable = await runOrchestratorToCompletion(
    "run1",
    deps(
      recoverableStore,
      recModel,
      fakeRegistry({
        plan_shots: () => ({
          status: "failed",
          error: { kind: "provider_quota", message: "rate limited", recoverable: true },
        }),
      })
    )
  );
  assert.equal(recoverable.status, "succeeded");
  assert.equal(recoverableStore.actions[0].status, "failed");

  const fatalStore = new FakeStore(runFixture());
  const { model: fatalModel } = scriptedModel([{ type: "tool_call", toolName: "plan_shots" }]);
  const fatal = await runOrchestratorToCompletion(
    "run1",
    deps(
      fatalStore,
      fatalModel,
      fakeRegistry({
        plan_shots: () => ({
          status: "failed",
          error: { kind: "policy_violation", message: "nope", recoverable: false },
        }),
      })
    )
  );
  assert.equal(fatal.status, "failed");
  assert.equal((fatal.error as { kind?: string }).kind, "policy_violation");
});

test("stops the run when the budget is exhausted", async () => {
  const store = new FakeStore(runFixture({ budgetUsd: 1 }));
  const { model } = scriptedModel([
    { type: "tool_call", toolName: "plan_shots" },
    { type: "tool_call", toolName: "plan_shots" },
  ]);
  const registry = fakeRegistry({ plan_shots: () => ok([], 2) }); // costs 2 > budget 1

  const run = await runOrchestratorToCompletion("run1", deps(store, model, registry));
  assert.equal(run.status, "failed");
  assert.equal((run.error as { kind?: string }).kind, "budget_exceeded");
  assert.equal(store.actions.length, 1, "only the first tool runs before the budget trips");
});

test("blocks estimated platform-key generation when the balance cannot cover it", async () => {
  const store = new FakeStore(runFixture());
  const { model } = scriptedModel([{ type: "tool_call", toolName: "generate_clip" }]);
  let executed = false;
  const registry = fakeRegistry(
    {
      generate_clip: () => {
        executed = true;
        return ok(["clip_1"], 1);
      },
    },
    { generate_clip: 1 }
  );

  const run = await runOrchestratorToCompletion(
    "run1",
    deps(store, model, registry, {
      resolveOwnerUserId: async () => "user1",
      getCreditBalance: async () => 199,
      userHasAnyProviderKey: async () => false,
    })
  );

  assert.equal(run.status, "failed");
  assert.equal(executed, false, "the billable tool must not execute");
  assert.equal((run.error as { kind?: string }).kind, "insufficient_credits");
  assert.equal(store.actions.length, 1);
  assert.equal(store.actions[0].status, "failed");
  assert.equal((store.actions[0].error as { kind?: string }).kind, "insufficient_credits");
});

test("allows estimated generation with low credits when the user has a provider key", async () => {
  const store = new FakeStore(runFixture());
  const { model } = scriptedModel([
    { type: "tool_call", toolName: "generate_clip" },
    { type: "done" },
  ]);
  let executed = false;
  const registry = fakeRegistry(
    {
      generate_clip: () => {
        executed = true;
        return ok(["clip_1"]);
      },
    },
    { generate_clip: 1 }
  );

  const run = await runOrchestratorToCompletion(
    "run1",
    deps(store, model, registry, {
      resolveOwnerUserId: async () => "user1",
      getCreditBalance: async () => 1,
      userHasAnyProviderKey: async () => true,
    })
  );

  assert.equal(run.status, "succeeded");
  assert.equal(executed, true);
  assert.equal(store.actions[0].status, "applied");
});
