import assert from "node:assert/strict";
import test from "node:test";
import type { OrchestratorRun } from "@/lib/api/v1/orchestrator-store";
import {
  isOrchestratorRecoveryEnabled,
  orchestratorRecoveryIntervalMs,
  orchestratorTickBackoffMs,
  recoverOrchestratorRuns,
} from "../recovery-worker";

function run(status: OrchestratorRun["status"]): OrchestratorRun {
  return {
    id: `run-${status}`,
    schemaVersion: "orchestrator_run.v1",
    projectId: "project-1",
    status,
    inputSummary: "test",
    rootExecutionProfile: "creative_director",
    spentUsd: 0,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
  };
}

test("worker processes only atomically claimed dispatches", async () => {
  const started: string[] = [];
  const resumed: string[] = [];
  const released: Array<{ completed: boolean }> = [];
  const recovered = await recoverOrchestratorRuns({
    claim: async () => [
      { dispatchId: "dispatch-queued", runId: "run-queued", workspaceId: "workspace-1", leaseToken: "lease-1" },
      { dispatchId: "dispatch-running", runId: "run-running", workspaceId: "workspace-1", leaseToken: "lease-2" },
      { dispatchId: "dispatch-waiting", runId: "run-waiting", workspaceId: "workspace-1", leaseToken: "lease-3" },
    ],
    getRun: async (id) => run(
      id === "run-queued" ? "queued" : id === "run-waiting" ? "waiting" : "running"
    ),
    listGates: async () => [],
    release: async (input) => { released.push({ completed: input.completed }); },
    run: async (id) => {
      started.push(id);
      return run("running");
    },
    resume: async (id) => {
      resumed.push(id);
      return run("running");
    },
    logger: { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } },
  });
  assert.equal(recovered, 3);
  assert.deepEqual(started, ["run-queued", "run-running"]);
  assert.deepEqual(resumed, ["run-waiting"]);
  assert.deepEqual(released, [{ completed: false }, { completed: false }, { completed: false }]);
});

test("worker sweeps ready rerun callbacks before normal dispatch claims", async () => {
  const order: string[] = [];
  await recoverOrchestratorRuns({
    repair: async () => { order.push("repair"); },
    resumeReruns: async () => { order.push("reruns"); return 1; },
    claim: async () => { order.push("claim"); return []; },
    logger: { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } },
  });
  assert.deepEqual(order, ["repair", "reruns", "claim"]);
});

test("worker forwards a claimed domain session generation to the shared engine", async () => {
  let seenGeneration: number | undefined;
  let seenRoles: readonly string[] | undefined;
  let domainRuntimeEnabled: boolean | undefined;
  await recoverOrchestratorRuns({
    claim: async () => [{
      dispatchId: "dispatch-domain",
      runId: "run-domain",
      workspaceId: "workspace-1",
      leaseToken: "lease-1",
      agentSessionId: "session-1",
      sessionClaimGeneration: 7,
    }],
    getRun: async () => ({ ...run("queued"), agentRole: "visuals", rootExecutionProfile: undefined }),
    listGates: async () => [],
    release: async () => {},
    run: async (_id, deps) => {
      seenGeneration = deps.sessionClaimGeneration;
      seenRoles = deps.enabledDomainRoles;
      domainRuntimeEnabled = deps.domainRuntimeEnabled;
      return { ...run("queued"), agentRole: "visuals" };
    },
    resume: async () => assert.fail("queued run must not resume"),
    logger: { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } },
  });
  assert.equal(seenGeneration, 7);
  assert.deepEqual(seenRoles, ["visuals", "audio"]);
  assert.equal(domainRuntimeEnabled, true);
});

test("terminal finite-run states retire a recovered dispatch without another turn", async () => {
  for (const status of ["timed_out", "superseded"] as const) {
    let called = false;
    const releases: boolean[] = [];
    await recoverOrchestratorRuns({
      claim: async () => [{
        dispatchId: `dispatch-${status}`,
        runId: `run-${status}`,
        workspaceId: "workspace-1",
        leaseToken: "lease-1",
      }],
      getRun: async () => run(status),
      listGates: async () => [],
      release: async ({ completed }) => { releases.push(completed); },
      run: async () => { called = true; return run(status); },
      resume: async () => { called = true; return run(status); },
      logger: { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } },
    });
    assert.equal(called, false, `${status} must not re-enter the engine`);
    assert.deepEqual(releases, [true]);
  }
});

test("worker retires a legacy root dispatch without entering the engine", async () => {
  const events: string[] = [];
  const canceled: Array<{ projectId: string; runId: string }> = [];
  let enteredEngine = false;
  await recoverOrchestratorRuns({
    claim: async () => [{
      dispatchId: "dispatch-legacy",
      runId: "run-legacy",
      workspaceId: "workspace-1",
      leaseToken: "lease-1",
    }],
    getRun: async () => ({
      ...run("queued"),
      id: "run-legacy",
      rootExecutionProfile: "flat",
    }),
    cancelFamily: async (input) => {
      events.push("cancel");
      canceled.push(input);
      return { canceledRunIds: [input.runId], canceledJobIds: [] };
    },
    listGates: async () => assert.fail("legacy root must be refused before gate loading"),
    release: async ({ completed }) => { events.push(`release:${completed}`); },
    run: async () => { enteredEngine = true; return run("running"); },
    resume: async () => { enteredEngine = true; return run("running"); },
    logger: { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } },
  });
  assert.equal(enteredEngine, false);
  assert.deepEqual(canceled, [{ projectId: "project-1", runId: "run-legacy" }]);
  assert.deepEqual(events, ["cancel", "release:true"]);
});

test("failed legacy-family cancellation never retires the dispatch as completed", async () => {
  const releases: boolean[] = [];
  await recoverOrchestratorRuns({
    claim: async () => [{
      dispatchId: "dispatch-legacy",
      runId: "run-legacy",
      workspaceId: "workspace-1",
      leaseToken: "lease-1",
    }],
    getRun: async () => ({
      ...run("queued"),
      id: "run-legacy",
      rootExecutionProfile: undefined,
    }),
    cancelFamily: async () => {
      throw new Error("cancellation unavailable");
    },
    listGates: async () => assert.fail("legacy root must be refused before gate loading"),
    release: async ({ completed }) => { releases.push(completed); },
    run: async () => assert.fail("legacy root must not enter the engine"),
    resume: async () => assert.fail("legacy root must not enter the engine"),
    logger: { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } },
  });
  assert.deepEqual(releases, [false]);
});

test("recovery is enabled by default and has a safe lower interval bound", () => {
  assert.equal(isOrchestratorRecoveryEnabled({}), true);
  assert.equal(isOrchestratorRecoveryEnabled({ ORCHESTRATOR_RECOVERY_ENABLED: "false" }), false);
  assert.equal(orchestratorRecoveryIntervalMs({ ORCHESTRATOR_RECOVERY_INTERVAL_MS: "10" }), 1_000);
});

test("worker logs the persisted root profile rather than a mutable process flag", async () => {
  let rolloutLog: Record<string, unknown> | undefined;
  await recoverOrchestratorRuns({
    claim: async () => [{ dispatchId: "dispatch-root", runId: "run-root", workspaceId: "workspace-1", leaseToken: "lease-1" }],
    getRun: async () => ({ ...run("queued"), rootExecutionProfile: "creative_director" }),
    listGates: async () => [],
    release: async () => {},
    run: async () => run("succeeded"),
    resume: async () => assert.fail("queued root must not resume"),
    repair: async () => {},
    logger: {
      debug() {},
      info(event, details) { if (event === "orchestrator_worker.rollout") rolloutLog = details; },
      warn() {}, error() {}, child() { return this; },
    },
  });
  assert.equal(rolloutLog?.rootExecutionProfile, "creative_director");
});

test("failed ticks back off exponentially and cap at 30s", () => {
  assert.equal(orchestratorTickBackoffMs(0), 0);
  assert.equal(orchestratorTickBackoffMs(1, 1_000), 2_000);
  assert.equal(orchestratorTickBackoffMs(2, 1_000), 4_000);
  assert.equal(orchestratorTickBackoffMs(3, 1_000), 8_000);
  assert.equal(orchestratorTickBackoffMs(10, 1_000), 30_000);
  assert.equal(orchestratorTickBackoffMs(1_000, 1_000), 30_000);
});
