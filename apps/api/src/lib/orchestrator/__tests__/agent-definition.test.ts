import assert from "node:assert/strict";
import test from "node:test";
import type { DomainOutputKind, DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";
import type { GraphAssetKind } from "@/lib/api/v1/store-content";
import type { OrchestratorRun } from "@/lib/api/v1/orchestrator-store";
import { runOrchestratorToCompletion } from "../engine";
import {
  assertDomainCompletionOutputCoverage,
  assertDomainRegistry,
  buildDomainReportFromCompletion,
  compactRootDomainReports,
  resolveAgentDefinition,
  validateDomainCompletionBoundOutputClaims,
  validateDomainCompletionOutputInventory,
} from "../agent-definition";
import { CREATIVE_DIRECTOR_SYSTEM_PROMPT } from "../creative-director-agent";
import type { ToolRegistry } from "../registry";
import type {
  AgentDefinition,
  DomainCompletionOutputInventoryItem,
} from "../agent-definition";

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

test("root definition accepts an exact test registry seam", async () => {
  const registry: ToolRegistry = new Map();
  const definition = await resolveAgentDefinition({
    run: rootRun,
    workspaceId: "workspace-1",
    rootRegistry: registry,
  });
  assert.equal(definition.role, "creative_director");
  assert.equal(definition.registry, registry);
});

test("creative-director root exposes only the creative-director surface", async () => {
  const definition = await resolveAgentDefinition({
    run: rootRun,
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

test("domain completion accepts one exact JSON fence but rejects surrounding prose", async () => {
  const completion = JSON.stringify({
    outcome: "question",
    question: "Which visual direction should this clip use?",
    options: [
      { id: "warm", label: "Warm", tradeoff: "Softer and nostalgic." },
      { id: "cool", label: "Cool", tradeoff: "Sharper and more distant." },
    ],
  });
  const report = await buildDomainReportFromCompletion({
    runId: "domain-run",
    projectId: "project-1",
    task: visualTask,
    actions: [],
    summary: `\`\`\`json\n${completion}\n\`\`\``,
  });
  assert.equal(report.outcome.outcome, "question");

  await assert.rejects(
    buildDomainReportFromCompletion({
      runId: "domain-run",
      projectId: "project-1",
      task: visualTask,
      actions: [],
      summary: `Done.\n\`\`\`json\n${completion}\n\`\`\``,
    }),
    /valid JSON/
  );
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

test("reproduces a malformed done completion after its output asset already validated", async () => {
  let outputValidationCalls = 0;
  await assert.rejects(
    buildDomainReportFromCompletion({
      runId: "domain-run",
      projectId: "project-1",
      task: visualTask,
      actions: [{
        id: "image-action",
        tool: "generate_image_asset",
        status: "applied",
        params: {},
        outputAssetIds: ["image-1"],
        jobIds: ["image-job"],
        createdAt: "2026-08-01T00:00:00.000Z",
      }],
      summary: JSON.stringify({
        outcome: "done",
        acceptanceEvidence: [],
        sessionSummary: "The requested image is ready.",
      }),
    }, {
      validatedOutputs: async () => {
        outputValidationCalls += 1;
        return [{ assetId: "image-1", intrinsicRole: "standalone_image", kind: "clip" }];
      },
    }),
    /one acceptance evidence item per criterion/
  );
  assert.equal(outputValidationCalls, 1, "the asset must validate before evidence rejects completion");
});

test("done completion rejects explicitly unsatisfied acceptance evidence", async () => {
  await assert.rejects(
    buildDomainReportFromCompletion({
      runId: "domain-run",
      projectId: "project-1",
      task: visualTask,
      actions: [],
      summary: JSON.stringify({
        outcome: "done",
        acceptanceEvidence: [{
          criterion: "Produce one approved clip.",
          satisfied: false,
          evidence: "The output does not meet the requested quality.",
          assetIds: ["clip-1"],
        }],
        sessionSummary: "The clip needs clarification.",
      }),
    }, {
      validatedOutputs: async () => [{
        assetId: "clip-1",
        intrinsicRole: "primary",
        kind: "clip",
      }],
    }),
    /requires every acceptance criterion to be satisfied/
  );
});

test("unbound semantic requirements need distinct role-compatible assets", () => {
  const multiStillTask = {
    ...visualTask,
    requiredOutputs: [
      { kind: "anchor", role: "visual_anchor", minimumCount: 1 },
      { kind: "image", role: "image", minimumCount: 1 },
    ],
    allowedOutputKinds: ["anchor", "image"],
  } as unknown as DomainTaskV1;

  assert.throws(
    () => assertDomainCompletionOutputCoverage({
      task: multiStillTask,
      inventory: [{
        assetId: "generic-image",
        kind: "anchor",
        intrinsicRole: "standalone_image",
      }],
    }),
    /distinct role-compatible assets/
  );

  assert.doesNotThrow(() => assertDomainCompletionOutputCoverage({
    task: multiStillTask,
    inventory: [
      { assetId: "anchor", kind: "anchor", intrinsicRole: "character_anchor" },
      { assetId: "generic-image", kind: "image", intrinsicRole: "standalone_image" },
    ],
  }));

  assert.throws(
    () => assertDomainCompletionOutputCoverage({
      task: {
        ...multiStillTask,
        requiredOutputs: [{ kind: "image", role: "image", minimumCount: 2 }],
        allowedOutputKinds: ["image"],
      } as unknown as DomainTaskV1,
      inventory: [{
        assetId: "generic-image",
        kind: "image",
        intrinsicRole: "standalone_image",
      }],
    }),
    /distinct role-compatible assets/
  );
});

test("completion accepts every persisted domain graph kind, including creator-direct clips", () => {
  const cases = [
    { semanticKind: "image", graphKind: "image", role: "standalone_image" },
    { semanticKind: "poster", graphKind: "poster", role: "poster" },
    { semanticKind: "anchor", graphKind: "anchor", role: "character_anchor" },
    { semanticKind: "storyboard", graphKind: "keyframe", role: "beat_storyboard" },
    { semanticKind: "storyboard", graphKind: "keyframe", role: "scene_storyboard" },
    { semanticKind: "storyboard", graphKind: "keyframe", role: "act_mockup" },
    { semanticKind: "keyframe", graphKind: "keyframe", role: "beat_keyframe" },
    { semanticKind: "clip", graphKind: "clip", role: "standalone_video" },
    { semanticKind: "audio_track", graphKind: "audio_track", role: "voiceover" },
    { semanticKind: "audio_fit", graphKind: "critique", role: "audio_fit" },
    { semanticKind: "composite", graphKind: "composite", role: "composition" },
    { semanticKind: "render", graphKind: "render", role: "export_video" },
  ] satisfies readonly {
    semanticKind: DomainOutputKind;
    graphKind: GraphAssetKind;
    role: string;
  }[];

  for (const { semanticKind, graphKind, role } of cases) {
    const task = {
      ...visualTask,
      requiredOutputs: [{ kind: semanticKind, role: "primary", minimumCount: 1 }],
      allowedOutputKinds: [semanticKind],
    } as DomainTaskV1;
    assert.doesNotThrow(() => validateDomainCompletionOutputInventory({
      projectId: "project-1",
      task,
      ids: [`${semanticKind}-${role}`],
      rows: [{
        id: `${semanticKind}-${role}`,
        project_id: "project-1",
        kind: graphKind,
        role,
        status: "ready",
      }],
      requireComplete: true,
    }), `${semanticKind} should accept ${graphKind}/${role}`);
  }
});

test("completion trusts canonical graph kinds and fails closed for overloaded roles", () => {
  const assertAccepted = (input: {
    semanticKind: DomainOutputKind;
    graphKind: GraphAssetKind;
    role: string;
  }) => assert.doesNotThrow(() => validateDomainCompletionOutputInventory({
    projectId: "project-1",
    task: {
      ...visualTask,
      requiredOutputs: [{ kind: input.semanticKind, role: "primary", minimumCount: 1 }],
      allowedOutputKinds: [input.semanticKind],
    } as DomainTaskV1,
    ids: ["asset-1"],
    rows: [{
      id: "asset-1",
      project_id: "project-1",
      kind: input.graphKind,
      role: input.role,
      status: "ready",
    }],
    requireComplete: true,
  }));

  assertAccepted({ semanticKind: "clip", graphKind: "clip", role: "standalone_image" });
  assertAccepted({ semanticKind: "image", graphKind: "image", role: "beat_clip" });

  for (const input of [
    { semanticKind: "keyframe", graphKind: "keyframe", role: "beat_storyboard" },
    { semanticKind: "storyboard", graphKind: "keyframe", role: "beat_keyframe" },
    { semanticKind: "keyframe", graphKind: "keyframe", role: "unknown" },
    { semanticKind: "audio_fit", graphKind: "critique", role: "visual_critique" },
  ] satisfies readonly {
    semanticKind: DomainOutputKind;
    graphKind: GraphAssetKind;
    role: string;
  }[]) {
    assert.throws(() => validateDomainCompletionOutputInventory({
      projectId: "project-1",
      task: {
        ...visualTask,
        requiredOutputs: [{ kind: input.semanticKind, role: "primary", minimumCount: 1 }],
        allowedOutputKinds: [input.semanticKind],
      } as DomainTaskV1,
      ids: ["asset-1"],
      rows: [{
        id: "asset-1",
        project_id: "project-1",
        kind: input.graphKind,
        role: input.role,
        status: "ready",
      }],
      requireComplete: true,
    }), /allowed semantic output kinds/);
  }
});

test("bound claims enforce semantic roles and one distinct asset per binding", () => {
  const target = {
    kind: "project" as const,
    projectId: "project-1",
  };
  const boundTask = {
    ...visualTask,
    targets: [target],
    requiredOutputs: [
      {
        bindingId: "anchor-binding",
        workItemId: "anchor-work",
        target,
        kind: "anchor",
        role: "visual_anchor",
        ordinal: 0,
        minimumCount: 1,
      },
      {
        bindingId: "image-binding",
        workItemId: "image-work",
        target,
        kind: "image",
        role: "image",
        ordinal: 0,
        minimumCount: 1,
      },
    ],
    allowedOutputKinds: ["anchor", "image"],
  } as DomainTaskV1;
  const inventory = [
    { assetId: "anchor", kind: "anchor", intrinsicRole: "character_anchor" },
    { assetId: "image", kind: "image", intrinsicRole: "standalone_image" },
  ] satisfies DomainCompletionOutputInventoryItem[];

  assert.doesNotThrow(() => validateDomainCompletionBoundOutputClaims({
    task: boundTask,
    inventory,
    claimedOutputs: [
      { bindingId: "anchor-binding", assetId: "anchor" },
      { bindingId: "image-binding", assetId: "image" },
    ],
  }));
  assert.throws(
    () => validateDomainCompletionBoundOutputClaims({
      task: boundTask,
      inventory,
      claimedOutputs: [
        { bindingId: "anchor-binding", assetId: "image" },
        { bindingId: "image-binding", assetId: "anchor" },
      ],
    }),
    /does not satisfy binding (anchor|image)-binding/
  );
  assert.throws(
    () => validateDomainCompletionBoundOutputClaims({
      task: {
        ...boundTask,
        requiredOutputs: boundTask.requiredOutputs.map((required) => ({
          ...required,
          kind: "image" as const,
          role: "image",
        })),
        allowedOutputKinds: ["image"],
      } as DomainTaskV1,
      inventory: [inventory[1]],
      claimedOutputs: [
        { bindingId: "anchor-binding", assetId: "image" },
        { bindingId: "image-binding", assetId: "image" },
      ],
    }),
    /exactly this run's output assets/
  );
});

test("partial completion inventory still rejects missing, foreign, and semantic mismatches", () => {
  const imageOnlyTask = {
    ...visualTask,
    requiredOutputs: [{ kind: "image", role: "image", minimumCount: 1 }],
    allowedOutputKinds: ["image"],
  } as unknown as DomainTaskV1;

  assert.throws(
    () => validateDomainCompletionOutputInventory({
      projectId: "project-1",
      task: imageOnlyTask,
      ids: ["missing"],
      rows: [],
      requireComplete: false,
    }),
    /outside its project/
  );
  assert.throws(
    () => validateDomainCompletionOutputInventory({
      projectId: "project-1",
      task: imageOnlyTask,
      ids: ["foreign"],
      rows: [{
        id: "foreign",
        project_id: "project-2",
        kind: "image",
        role: "standalone_image",
        status: "ready",
      }],
      requireComplete: false,
    }),
    /outside its project/
  );
  assert.throws(
    () => validateDomainCompletionOutputInventory({
      projectId: "project-1",
      task: imageOnlyTask,
      ids: ["pending"],
      rows: [{
        id: "pending",
        project_id: "project-1",
        kind: "image",
        role: "standalone_image",
        status: "pending",
      }],
      requireComplete: false,
    }),
    /not ready/
  );
  assert.throws(
    () => validateDomainCompletionOutputInventory({
      projectId: "project-1",
      task: imageOnlyTask,
      ids: ["semantic-mismatch"],
      rows: [{
        id: "semantic-mismatch",
        project_id: "project-1",
        kind: "anchor",
        role: "character_anchor",
        status: "ready",
      }],
      requireComplete: false,
    }),
    /allowed output kinds/
  );

  const partialTask = {
    ...visualTask,
    requiredOutputs: [
      { kind: "anchor", role: "visual_anchor", minimumCount: 1 },
      { kind: "image", role: "image", minimumCount: 1 },
    ],
    allowedOutputKinds: ["anchor", "image"],
  } as unknown as DomainTaskV1;
  const partialInput = {
    projectId: "project-1",
    task: partialTask,
    ids: ["anchor"],
    rows: [{
      id: "anchor",
      project_id: "project-1",
      kind: "anchor",
      role: "character_anchor",
      status: "ready",
    }],
  } as const;
  assert.doesNotThrow(() => validateDomainCompletionOutputInventory({
    ...partialInput,
    requireComplete: false,
  }));
  assert.throws(
    () => validateDomainCompletionOutputInventory({
      ...partialInput,
      requireComplete: true,
    }),
    /distinct role-compatible assets/
  );
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
  let completionMode: string | undefined;
  const result = await runOrchestratorToCompletion(run.id, {
    workspaceId: "workspace-1",
    store,
    domainRuntimeEnabled: true,
    sessionClaimGeneration: 42,
    resolveOwnerUserId: async () => null,
    resolveAgentDefinition: async () => definition,
    model: async (input) => {
      completionMode = input.completionMode;
      return {
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
      };
    },
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
  assert.equal(completionMode, "domain_json");
  assert.equal(result.status, "succeeded");
});
