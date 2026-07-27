import assert from "node:assert/strict";
import test from "node:test";
import type { DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";
import type { OrchestratorRun } from "@/lib/api/v1/orchestrator-store";
import { runOrchestratorToCompletion } from "../engine";
import {
  assertDomainRegistry,
  buildDomainReportFromCompletion,
  resolveAgentDefinition,
} from "../agent-definition";
import type { ToolRegistry } from "../registry";

const rootRun: OrchestratorRun = {
  id: "root-run",
  schemaVersion: "orchestrator_run.v1",
  projectId: "project-1",
  status: "queued",
  inputSummary: "make a short film",
  spentUsd: 0,
  createdAt: "2026-07-27T00:00:00.000Z",
  updatedAt: "2026-07-27T00:00:00.000Z",
};

const visualTask = {
  schemaVersion: "DomainTask.v1",
  domain: "visuals",
  taskKind: "visuals_production",
  objective: "Produce one approved clip.",
  instruction: "Create the clip for the supplied beat.",
  targets: [{ kind: "project", projectId: "project-1" }],
  requiredOutputs: [{ kind: "clip", role: "primary", minimumCount: 1 }],
  allowedOutputKinds: ["clip"],
  creativeConstraints: {},
  preserve: { assetIds: [], selections: [], fingerprints: [], pins: [] },
  candidateAffectedAssetIds: [],
  budgetUsd: 1,
  acceptanceCriteria: ["Produce one approved clip."],
  origin: {
    kind: "creative_director",
    rootRunId: "root-run",
    rootActionId: "root-action",
    creatorMessageId: "message-1",
  },
  responseRecipient: { kind: "creative_director" },
} as unknown as DomainTaskV1;

test("root definition preserves the supplied flat registry and carries no structured context", async () => {
  const registry: ToolRegistry = new Map();
  const definition = await resolveAgentDefinition({
    run: rootRun,
    workspaceId: "workspace-1",
    rootRegistry: registry,
  });
  assert.equal(definition.role, "creative_director");
  assert.equal(definition.registry, registry);
  assert.equal(await definition.loadTurnContext(), undefined);
});

test("domain registries reject dispatch capabilities and foreign ownership", () => {
  const forbidden = new Map([
    ["delegate_visuals", { name: "delegate_visuals", ownerRole: "creative_director" }],
  ]) as unknown as ToolRegistry;
  assert.throws(() => assertDomainRegistry("visuals", forbidden), /forbidden tool/);
});

test("question completion derives trusted targets and a server fingerprint", async () => {
  const report = await buildDomainReportFromCompletion({
    runId: "domain-run",
    projectId: "project-1",
    task: visualTask,
    actions: [],
    summary: JSON.stringify({
      outcome: "question",
      question: "Which visual direction should this clip use?",
      options: [
        { id: "warm", label: "Warm", tradeoff: "Softer and nostalgic." },
        { id: "cool", label: "Cool", tradeoff: "Sharper and more distant." },
      ],
    }),
  });
  assert.equal(report.outcome.outcome, "question");
  if (report.outcome.outcome === "question") {
    assert.deepEqual(report.outcome.targets, visualTask.targets);
    assert.match(report.outcome.fingerprint, /^[a-f0-9]{64}$/);
  }
});

test("disabled domain runtime does not invoke a model or tool", async () => {
  const run = { ...rootRun, id: "visual-run", agentRole: "visuals" as const };
  const store = {
    getOrchestratorRun: async () => run,
    updateOrchestratorRun: async () => run,
    listRunGates: async () => [],
    markGateReached: async () => null,
    listRunActions: async () => [],
    recordInvocation: async () => assert.fail("domain runtime must not record an action"),
    markInvocation: async () => assert.fail("domain runtime must not mark an action"),
  };
  const result = await runOrchestratorToCompletion(run.id, {
    workspaceId: "workspace-1",
    store,
    model: async () => assert.fail("disabled domain runtime must not call the model"),
  });
  assert.equal(result.status, "queued");
});
