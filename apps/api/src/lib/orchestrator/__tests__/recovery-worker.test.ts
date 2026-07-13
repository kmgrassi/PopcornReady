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
    ],
    getRun: async (id) => run(id === "run-queued" ? "queued" : "running"),
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
  assert.equal(recovered, 2);
  assert.deepEqual(started, ["run-queued"]);
  assert.deepEqual(resumed, ["run-running"]);
  assert.deepEqual(released, [{ completed: false }, { completed: false }]);
});

test("recovery is enabled by default and has a safe lower interval bound", () => {
  assert.equal(isOrchestratorRecoveryEnabled({}), true);
  assert.equal(isOrchestratorRecoveryEnabled({ ORCHESTRATOR_RECOVERY_ENABLED: "false" }), false);
  assert.equal(orchestratorRecoveryIntervalMs({ ORCHESTRATOR_RECOVERY_INTERVAL_MS: "10" }), 1_000);
});

test("failed ticks back off exponentially and cap at 30s", () => {
  assert.equal(orchestratorTickBackoffMs(0), 0);
  assert.equal(orchestratorTickBackoffMs(1, 1_000), 2_000);
  assert.equal(orchestratorTickBackoffMs(2, 1_000), 4_000);
  assert.equal(orchestratorTickBackoffMs(3, 1_000), 8_000);
  assert.equal(orchestratorTickBackoffMs(10, 1_000), 30_000);
  assert.equal(orchestratorTickBackoffMs(1_000, 1_000), 30_000);
});
