import assert from "node:assert/strict";
import test from "node:test";
import type { DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";
import type { OrchestratorRun } from "@/lib/api/v1/orchestrator-store";
import { runOrchestratorToCompletion } from "../engine";
import {
  assertDomainRegistry,
  buildDomainReportFromCompletion,
  compactRootDomainReports,
  resolveAgentDefinition,
} from "../agent-definition";
import { CREATIVE_DIRECTOR_SYSTEM_PROMPT } from "../creative-director-agent";
import type { ToolRegistry } from "../registry";
import type { AgentDefinition } from "../agent-definition";

const rootRun: OrchestratorRun = {
  id: "root-run",
  schemaVersion: "orchestrator_run.v1",
  projectId: "project-1",
  status: "queued",
  inputSummary: "make a short film",
  rootExecutionProfile: "creative_director",
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

test("root definition ignores a supplied flat registry and uses hierarchy context", async () => {
  const registry: ToolRegistry = new Map();
  const definition = await resolveAgentDefinition({
    run: rootRun,
    workspaceId: "workspace-1",
    rootRegistry: registry,
  });
  assert.equal(definition.role, "creative_director");
  assert.notEqual(definition.registry, registry);
});

test("creative-director root profile exposes only the creative-director surface", async () => {
  const definition = await resolveAgentDefinition({
    run: { ...rootRun, rootExecutionProfile: "creative_director" },
    workspaceId: "workspace-1",
  });
  assert.equal(definition.systemPrompt, CREATIVE_DIRECTOR_SYSTEM_PROMPT);
  assert.deepEqual([...definition.registry.keys()], [
    "create_or_load_brief",
    "develop_story_blueprint",
    "draft_script",
    "plan_shots",
    "plan_visual_anchors",
    "critique_timeline",
    "export_video",
    "request_approval",
    "assemble_timeline",
    "publish_to_catalog",
    "delegate_visuals",
    "delegate_audio",
    "delegate_domains",
  ]);
  assert.equal(definition.registry.has("generate_clip"), false);
  assert.equal(definition.registry.has("generate_audio"), false);
});

test("a legacy root without a durable profile cannot resolve an agent definition", async () => {
  await assert.rejects(
    resolveAgentDefinition({
      run: { ...rootRun, rootExecutionProfile: undefined },
      workspaceId: "workspace-1",
    }),
    /legacy history/
  );
});

test("root context reports include only root-origin specialist completions", () => {
  const reports = compactRootDomainReports({
    rootRunId: "root-run",
    family: {
      root: rootRun,
      children: [
        {
          id: "visuals-root-child",
          agentRole: "visuals",
          agentSessionId: "visuals-session",
          taskKind: "visuals_production",
          originKind: "creative_director",
          parentRunId: "root-run",
          reportActionId: "report-root",
          report: {
            schemaVersion: "DomainReport.v1",
            outcome: {
              outcome: "done",
              outputs: [{ assetId: "anchor-1", intrinsicRole: "visual_anchor" }],
              changedSelections: [],
              acceptanceEvidence: [],
              sessionSummary: "Anchor plan complete.",
            },
          },
        },
        {
          id: "visuals-direct-child",
          agentRole: "visuals",
          agentSessionId: "visuals-session",
          taskKind: "image_create",
          originKind: "creator_direct",
          parentRunId: "root-run",
          reportActionId: "report-direct",
          report: {
            schemaVersion: "DomainReport.v1",
            outcome: { outcome: "question", question: "ignored", targets: [], options: [], fingerprint: "x" },
          },
        },
      ],
    } as never,
  });
  assert.deepEqual(reports, [
    {
      runId: "visuals-root-child",
      sessionId: "visuals-session",
      domain: "visuals",
      taskKind: "visuals_production",
      reportActionId: "report-root",
      outcome: {
        outcome: "done",
        outputs: [{ assetId: "anchor-1", intrinsicRole: "visual_anchor" }],
        changedSelections: [],
        acceptanceEvidence: [],
        sessionSummary: "Anchor plan complete.",
      },
    },
  ]);
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

test("bound completion carries the exact server-issued output identity into the report", async () => {
  const boundTarget = {
    kind: "asset" as const,
    projectId: "project-1",
    assetId: "source-1",
  };
  const boundTask = {
    ...visualTask,
    targets: [boundTarget],
    requiredOutputs: [{
      bindingId: "binding-1",
      workItemId: "work-1",
      target: boundTarget,
      kind: "clip",
      role: "revised-clip",
      ordinal: 0,
      minimumCount: 1,
    }],
  } as DomainTaskV1;
  const report = await buildDomainReportFromCompletion({
    runId: "domain-run",
    projectId: "project-1",
    task: boundTask,
    actions: [],
    summary: JSON.stringify({
      outcome: "done",
      outputs: [{ bindingId: "binding-1", assetId: "clip-2" }],
      acceptanceEvidence: [{
        criterion: "Produce one approved clip.",
        satisfied: true,
        evidence: "Bound clip exists.",
        assetIds: ["clip-2"],
      }],
      sessionSummary: "Bound clip complete.",
    }),
  }, {
    validatedOutputs: async () => [{
      bindingId: "binding-1",
      workItemId: "work-1",
      target: boundTarget,
      kind: "clip",
      role: "revised-clip",
      ordinal: 0,
      assetId: "clip-2",
      intrinsicRole: "revised-clip",
    }],
  });
  assert.equal(report.outcome.outcome, "done");
  if (report.outcome.outcome === "done") {
    assert.deepEqual(report.outcome.outputs[0], {
      bindingId: "binding-1",
      workItemId: "work-1",
      target: boundTarget,
      kind: "clip",
      role: "revised-clip",
      ordinal: 0,
      assetId: "clip-2",
      intrinsicRole: "revised-clip",
    });
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

test("manual domain smoke drives a claimed question turn without a provider", async () => {
  let run: OrchestratorRun = {
    ...rootRun,
    id: "claimed-visual-run",
    status: "queued",
    agentRole: "visuals" as const,
  };
  const store = {
    getOrchestratorRun: async () => run,
    updateOrchestratorRun: async (_id: string, patch: Partial<OrchestratorRun>) => {
      run = { ...run, ...patch };
      return run;
    },
    listRunGates: async () => [],
    markGateReached: async () => null,
    listRunActions: async () => [],
    recordInvocation: async () => assert.fail("question smoke must not invoke a tool"),
    markInvocation: async () => assert.fail("question smoke must not mark a tool"),
  };
  const definition: AgentDefinition = {
    role: "visuals",
    registry: new Map(),
    systemPrompt: "test",
    task: visualTask,
    loadTurnContext: async () => ({ schemaVersion: "DomainTurnProjection.v1" }),
  };
  let finalizedGeneration: number | undefined;
  const result = await runOrchestratorToCompletion(run.id, {
    workspaceId: "workspace-1",
    store,
    domainRuntimeEnabled: true,
    sessionClaimGeneration: 42,
    resolveOwnerUserId: async () => null,
    resolveAgentDefinition: async () => definition,
    model: async () => ({
      type: "done",
      summary: JSON.stringify({
        outcome: "question",
        question: "Which visual direction should this clip use?",
        options: [
          { id: "warm", label: "Warm", tradeoff: "Softer and nostalgic." },
          { id: "cool", label: "Cool", tradeoff: "Sharper and more distant." },
        ],
      }),
      model: "manual-smoke",
    }),
    finalizeDomainTurn: async (input) => {
      finalizedGeneration = input.expectedClaimGeneration;
      run = { ...run, status: "succeeded" };
      return {
        reportActionId: "report-action",
        performed: true,
        recipient: "creative_director",
        parentRunId: "root-run",
        wokeParent: true,
        summaryApplied: true,
      };
    },
  });
  assert.equal(finalizedGeneration, 42);
  assert.equal(result.status, "succeeded");
});
