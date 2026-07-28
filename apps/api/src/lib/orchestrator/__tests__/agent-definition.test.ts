import assert from "node:assert/strict";
import test from "node:test";
import type { DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";
import type { OrchestratorRun } from "@/lib/api/v1/orchestrator-store";
import { runOrchestratorToCompletion, toPriorResult } from "../engine";
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

const audioFitTask = {
  ...visualTask,
  domain: "audio",
  taskKind: "audio_fit",
  objective: "Fit the approved narration to the current picture.",
  instruction: "Fit audio_target to picture_target without changing its words.",
  targets: [
    { kind: "asset", assetId: "audio_target" },
    { kind: "asset", assetId: "picture_target" },
  ],
  requiredOutputs: [{ kind: "audio_track", role: "voiceover", minimumCount: 1 }],
  allowedOutputKinds: ["audio_track"],
  preserve: {
    assetIds: ["audio_target"],
    selections: [],
    fingerprints: [],
    pins: [{ kind: "asset", id: "audio_target" }],
  },
  acceptanceCriteria: ["The approved narration is fitted to the current picture."],
} as unknown as DomainTaskV1;

const outputRows = async (_projectId: string, candidateIds: readonly string[]) =>
  candidateIds.map((id) => ({
    id,
    project_id: "project-1",
    kind: id === "fit_critique" ? "critique" : "audio_track",
    role: id === "fit_critique" ? "audio_fit" : "voiceover",
  }));

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

test("audio fit completion may report its exact existing audio target and ignore critique artifacts", async () => {
  const report = await buildDomainReportFromCompletion({
    runId: "audio-run",
    projectId: "project-1",
    task: audioFitTask,
    actions: [
      {
        id: "action-1",
        tool: "fit_audio_to_picture",
        status: "applied",
        params: {},
        outputAssetIds: ["fit_critique"],
        jobIds: [],
        createdAt: "2026-07-27T00:00:00.000Z",
      },
    ],
    summary: JSON.stringify({
      outcome: "done",
      outputAssetIds: ["audio_target"],
      sessionSummary: "The approved narration is fitted to the picture.",
      acceptanceEvidence: [
        {
          criterion: "The approved narration is fitted to the current picture.",
          satisfied: true,
          evidence: "The fit critique records alignment against picture_target.",
          assetIds: ["audio_target"],
        },
      ],
    }),
    loadOutputRows: outputRows,
  });

  assert.equal(report.outcome.outcome, "done");
  if (report.outcome.outcome === "done") {
    assert.deepEqual(report.outcome.outputs, [
      { assetId: "audio_target", intrinsicRole: "voiceover" },
    ]);
  }
});

test("a failed Audio fit becomes a typed creative question even when the model says done", async () => {
  const report = await buildDomainReportFromCompletion({
    runId: "audio-run",
    projectId: "project-1",
    task: audioFitTask,
    actions: [
      {
        id: "action-1",
        tool: "fit_audio_to_picture",
        status: "applied",
        params: {
          audioAssetId: "audio_target",
          pictureAssetId: "picture_target",
          beatId: "beat_1",
          result: { verdict: "fail", requiresApproval: true },
        },
        outputAssetIds: ["fit_critique"],
        jobIds: [],
        createdAt: "2026-07-27T00:00:00.000Z",
      },
    ],
    summary: JSON.stringify({ outcome: "done" }),
    loadOutputRows: outputRows,
  });

  assert.equal(report.outcome.outcome, "question");
  if (report.outcome.outcome === "question") {
    assert.match(report.outcome.question, /picture is too short/);
    assert.deepEqual(report.outcome.options.map((option) => option.id), [
      "revise_picture",
      "revise_words",
    ]);
  }
});

test("audio fit completion rejects an arbitrary existing audio asset", async () => {
  await assert.rejects(
    buildDomainReportFromCompletion({
      runId: "audio-run",
      projectId: "project-1",
      task: audioFitTask,
      actions: [],
      summary: JSON.stringify({
        outcome: "done",
        outputAssetIds: ["unrelated_audio"],
        sessionSummary: "Done.",
        acceptanceEvidence: [
          {
            criterion: "The approved narration is fitted to the current picture.",
            satisfied: true,
            evidence: "Claimed an unrelated asset.",
            assetIds: ["unrelated_audio"],
          },
        ],
      }),
      loadOutputRows: outputRows,
    }),
    /neither created by this run nor authorized as its fit target/
  );
});

test("applied audio fit actions retain the server-owned verdict for the next turn", () => {
  const result = toPriorResult({
    id: "fit-action",
    tool: "fit_audio_to_picture",
    status: "applied",
    params: {
      audioAssetId: "audio_target",
      pictureAssetId: "picture_target",
      beatId: "beat_1",
      result: {
        verdict: "needs_review",
        requiresApproval: true,
        reasons: ["retime_exceeds_cap"],
      },
    },
    outputAssetIds: ["fit_critique"],
    jobIds: [],
    createdAt: "2026-07-27T00:00:00.000Z",
  });
  assert.deepEqual(result.result, {
    verdict: "needs_review",
    requiresApproval: true,
    reasons: ["retime_exceeds_cap"],
  });
});

test("done completion never attributes a concurrent external selection to the domain run", async () => {
  const report = await buildDomainReportFromCompletion(
    {
      runId: "domain-run",
      projectId: "project-1",
      task: visualTask,
      actions: [],
      summary: JSON.stringify({
        outcome: "done",
        acceptanceEvidence: [
          {
            criterion: "Produce one approved clip.",
            satisfied: true,
            assetIds: ["clip-output"],
            evidence: "The pooled clip satisfies the requested visual output.",
          },
        ],
        sessionSummary: "Created one pooled clip.",
      }),
    },
    {
      validatedOutputs: async () => [
        { assetId: "clip-output", intrinsicRole: "beat_clip", kind: "clip" },
      ],
    }
  );

  assert.equal(report.outcome.outcome, "done");
  if (report.outcome.outcome === "done") {
    assert.deepEqual(report.outcome.changedSelections, []);
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

test("Visuals-only rollout leaves an otherwise identical Audio run queued", async () => {
  const run = { ...rootRun, id: "audio-run", agentRole: "audio" as const };
  const store = {
    getOrchestratorRun: async () => run,
    updateOrchestratorRun: async () => assert.fail("Audio must remain queued"),
    listRunGates: async () => [],
    markGateReached: async () => null,
    listRunActions: async () => [],
    recordInvocation: async () => assert.fail("Audio must not record an action"),
    markInvocation: async () => assert.fail("Audio must not mark an action"),
  };
  const result = await runOrchestratorToCompletion(run.id, {
    workspaceId: "workspace-1",
    store,
    enabledDomainRoles: ["visuals"],
    model: async () => assert.fail("Audio must not call the model"),
  });
  assert.equal(result.status, "queued");
});
