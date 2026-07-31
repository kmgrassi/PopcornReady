import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "@/core/errors";
import type {
  BoundRequiredOutput,
  RerunProposalV2,
  RerunWorkItem,
} from "@popcorn/shared/rerun-proposal";
import {
  createRootRerunExecutors,
  type RootRerunExecutorServices,
} from "../rerun-root-executors";
import {
  RetryableRerunExecutorError,
  RerunExecutorRegistry,
  type BoundExecutorOutput,
  type RerunExecutorContext,
} from "../rerun-executor-registry";
import { productionRerunExecutorRegistry } from "../rerun-production-registry";

const projectId = "00000000-0000-4000-8000-000000000001";
const rootRunId = "00000000-0000-4000-8000-000000000002";
const proposalActionId = "00000000-0000-4000-8000-000000000003";
const approvalActionId = "00000000-0000-4000-8000-000000000004";

const target = { kind: "beat", projectId, beatId: "beat-1" } as const;

function output(
  workItemId: string,
  kind: string,
  bindingId = `${workItemId}:${kind}`,
  role = kind
): BoundRequiredOutput {
  return {
    bindingId,
    workItemId,
    target,
    kind,
    role,
    ordinal: 0,
  };
}

function work(
  workItemId: string,
  kind: "revise_story" | "reassemble_cut" | "critique_cut",
  requiredOutputs: BoundRequiredOutput[]
): RerunWorkItem {
  return {
    workItemId,
    owner: "creative_director",
    kind,
    targets: [target],
    requiredOutputs,
  };
}

function proposal(selectedWork: [RerunWorkItem, ...RerunWorkItem[]]): Extract<
  RerunProposalV2,
  { outcome: "revision" }
> {
  return {
    schemaVersion: "RerunProposal.v2",
    projectId,
    rootRunId,
    source: "request_changes",
    userIntent: "Shorten beat one and tighten the cut.",
    targets: [target],
    inspectedAssetIds: ["story-old", "cut-old"],
    candidateAffectedAssetIds: ["story-old", "cut-old"],
    preservedAssetIds: ["clip-preserved"],
    checklist: [{ target, decision: "change", reason: "Approved request." }],
    pins: {
      assets: [
        { assetId: "story-old", contentHash: "story-hash", inputsFingerprint: null },
        { assetId: "cut-old", contentHash: "cut-hash", inputsFingerprint: "cut-inputs" },
        {
          assetId: "clip-preserved",
          contentHash: "preserved-hash",
          inputsFingerprint: "preserved-inputs",
        },
      ],
      selections: [{
        slotOwnerLineageId: null,
        slotRole: "cut",
        expectedActiveAssetId: "cut-old",
        expectedSeq: 4,
      }],
      storySnapshots: [{
        rowKind: "story_beat",
        rowId: "beat-1",
        expectedSnapshotAssetId: "story-old",
      }],
    },
    estimate: { costUsd: 0, maxCostUsd: 1, latencyClass: "interactive" },
    risk: "medium",
    requiresApproval: true,
    rationale: "Revise only the approved beat and dependent cut.",
    userFacingSummary: "Tighten beat one.",
    outcome: "revision",
    selectedWork,
    plannedSelectionMoves: [],
    plannedStoryPointerMoves: selectedWork.flatMap((item) =>
      item.requiredOutputs
        .filter((candidate) => candidate.kind === "story_snapshot")
        .map((candidate) => ({
          bindingId: candidate.bindingId,
          rowKind: "story_beat" as const,
          rowId: "beat-1",
          expectedSnapshotAssetId: "story-old",
        }))
    ),
  };
}

type Observed = {
  reserved: Array<{ reservationKey: string; estimatedUsd: number }>;
  settled: Array<{ reservationKey: string; actualUsd: number }>;
  released: string[];
  storyRequests: Parameters<RootRerunExecutorServices["stageStorySnapshot"]>[0][];
  assemblyRequests: Parameters<RootRerunExecutorServices["assembleProspectiveCut"]>[0][];
  critiqueRequests: Parameters<RootRerunExecutorServices["critiqueProspectiveCut"]>[0][];
};

function services(
  observed: Observed,
  overrides: Partial<RootRerunExecutorServices> = {}
): RootRerunExecutorServices {
  return {
    stageStorySnapshot: async (request) => {
      observed.storyRequests.push(request);
      return {
        assetId: "story-new",
        intrinsicRole: "beat_snapshot",
        actualCostUsd: 0,
      };
    },
    assembleProspectiveCut: async (request) => {
      observed.assemblyRequests.push(request);
      return {
        assetId: "cut-new",
        intrinsicRole: "timeline",
        actualCostUsd: 0,
      };
    },
    critiqueProspectiveCut: async (request) => {
      observed.critiqueRequests.push(request);
      return {
        assetId: "critique-new",
        intrinsicRole: "timeline_critique",
        actualCostUsd: 0.02,
        followupProposalActionId: "proposal-followup",
      };
    },
    estimateStoryUsd: () => 0,
    estimateAssemblyUsd: () => 0,
    estimateCritiqueUsd: () => 0.05,
    measuredActionCostUsd: async () => 0,
    settleBudget: async ({ reservationKey, actualUsd }) => {
      observed.settled.push({ reservationKey, actualUsd });
      return {} as never;
    },
    releaseBudget: async ({ reservationKey }) => {
      observed.released.push(reservationKey);
      return {} as never;
    },
    ...overrides,
  };
}

function observed(): Observed {
  return {
    reserved: [],
    settled: [],
    released: [],
    storyRequests: [],
    assemblyRequests: [],
    critiqueRequests: [],
  };
}

function completed(binding: BoundRequiredOutput, assetId: string): BoundExecutorOutput {
  return { ...binding, assetId, intrinsicRole: binding.role };
}

function context(input: {
  workItem: RerunWorkItem;
  selectedWork: [RerunWorkItem, ...RerunWorkItem[]];
  completed?: BoundExecutorOutput[];
  resolved?: BoundExecutorOutput[];
  reserve?: Observed;
}): RerunExecutorContext {
  const proposalValue = proposal(input.selectedWork);
  return {
    workspaceId: "workspace-1",
    projectId,
    actorId: "actor-1",
    proposalActionId,
    approvalActionId,
    approvedMaxCostUsd: 1,
    rootRunId,
    proposal: proposalValue,
    workItem: input.workItem,
    requiredOutputs: input.workItem.requiredOutputs,
    completedBindings: input.completed ?? [],
    resolveCompletedBindings: async () => input.resolved ?? [],
    reserveBudget: async ({ reservationKey, estimatedUsd }) => {
      input.reserve?.reserved.push({ reservationKey, estimatedUsd });
      return { reservationId: `budget:${reservationKey}`, replayed: false };
    },
    fence: {
      executionReservationId: "execution-1",
      workReservationId: `reservation:${input.workItem.workItemId}`,
      dispatchActionId: `dispatch:${input.workItem.workItemId}`,
      idempotencyKey: `idempotency:${input.workItem.workItemId}`,
      leaseToken: "lease-1",
      leaseGeneration: 1,
      callbackToken: "callback-1",
      callbackGeneration: 1,
    },
  };
}

test("root executors are active in the production registry", () => {
  const story = work("story-work", "revise_story", [
    output("story-work", "story_snapshot"),
  ]);
  assert.doesNotThrow(() => productionRerunExecutorRegistry.preflight([story]));
});

test("story coverage fails closed for aggregate storyboard and scene projections", () => {
  for (const unsupportedTarget of [
    { kind: "storyboard", projectId, storyboardId: "storyboard-1" } as const,
    { kind: "scene", projectId, sceneId: "scene-1" } as const,
  ]) {
    const binding = {
      ...output("story-work", "story_snapshot"),
      target: unsupportedTarget,
    };
    const story = {
      ...work("story-work", "revise_story", [binding]),
      targets: [unsupportedTarget],
    } as RerunWorkItem;
    assert.throws(
      () => productionRerunExecutorRegistry.preflight([story]),
      (error: unknown) =>
        error instanceof ApiError && error.code === "coverage_unavailable"
    );
  }
});

test("story coverage rejects multi-row work before execution", () => {
  const secondTarget = { kind: "beat", projectId, beatId: "beat-2" } as const;
  const secondOutput = {
    ...output("story-work", "story_snapshot", "story-work:story-2"),
    target: secondTarget,
    ordinal: 1,
  };
  const story = {
    ...work("story-work", "revise_story", [
      output("story-work", "story_snapshot", "story-work:story-1"),
      secondOutput,
    ]),
    targets: [target, secondTarget],
  } as RerunWorkItem;

  assert.throws(
    () => productionRerunExecutorRegistry.preflight([story]),
    (error: unknown) =>
      error instanceof ApiError && error.code === "coverage_unavailable"
  );
});

test("story executor stages one pinned snapshot without moving its stable row", async () => {
  const seen = observed();
  const story = work("story-work", "revise_story", [
    output("story-work", "story_snapshot"),
  ]);
  const executor = createRootRerunExecutors(services(seen))[0];
  const result = await executor.execute(context({
    workItem: story,
    selectedWork: [story],
    reserve: seen,
  }));

  assert.equal(result.status, "succeeded");
  assert.equal(result.outputs[0]?.assetId, "story-new");
  assert.deepEqual(seen.reserved.map((entry) => entry.estimatedUsd), [0]);
  assert.deepEqual(seen.settled.map((entry) => entry.actualUsd), [0]);
  assert.equal(seen.storyRequests[0]?.pointerMove.rowId, "beat-1");
  assert.equal(
    seen.storyRequests[0]?.pointerMove.expectedSnapshotAssetId,
    "story-old"
  );
  assert.equal(seen.storyRequests[0]?.pointerPin.rowId, "beat-1");
  assert.equal(seen.storyRequests[0]?.idempotencyKey, "idempotency:story-work");
});

test("story executor rejects missing or forged pointer authority", async () => {
  const seen = observed();
  const story = work("story-work", "revise_story", [
    output("story-work", "story_snapshot"),
  ]);
  const value = context({ workItem: story, selectedWork: [story], reserve: seen });
  value.proposal.plannedStoryPointerMoves = [];
  await assert.rejects(
    createRootRerunExecutors(services(seen))[0].execute(value),
    /one exact prospective pointer move/
  );
  assert.equal(seen.storyRequests.length, 0);
});

test("model-backed story failure settles recorded spend before terminal failure", async () => {
  const seen = observed();
  const story = work("story-work", "revise_story", [
    output("story-work", "story_snapshot"),
  ]);
  const executor = createRootRerunExecutors(services(seen, {
    stageStorySnapshot: async () => {
      throw new Error("structured call failed after usage");
    },
    measuredActionCostUsd: async () => 0.03,
  }))[0];

  await assert.rejects(
    executor.execute(context({ workItem: story, selectedWork: [story], reserve: seen })),
    (error: unknown) =>
      !(error instanceof RetryableRerunExecutorError) &&
      error instanceof Error &&
      /structured call failed/.test(error.message)
  );
  assert.deepEqual(seen.settled.map((entry) => entry.actualUsd), [0.03]);
  assert.deepEqual(seen.released, []);
});

test("assembly consumes exact prospective bindings and preserves active inputs", async () => {
  const seen = observed();
  const storyBinding = output("story-work", "story_snapshot");
  const clipBinding = output("visual-work", "clip");
  const story = work("story-work", "revise_story", [storyBinding]);
  const visual: RerunWorkItem = {
    workItemId: "visual-work",
    owner: "visuals",
    kind: "revise_visuals",
    targets: [target],
    requiredOutputs: [clipBinding],
  };
  const assembly = work("assembly-work", "reassemble_cut", [
    output("assembly-work", "composite"),
  ]);
  const completedOutputs = [
    completed(storyBinding, "story-new"),
    completed(clipBinding, "clip-new"),
  ];
  const executor = createRootRerunExecutors(services(seen))[1];
  const result = await executor.execute(context({
    workItem: assembly,
    selectedWork: [story, visual, assembly],
    resolved: completedOutputs,
    reserve: seen,
  }));

  assert.equal(result.status, "succeeded");
  assert.deepEqual(
    seen.assemblyRequests[0]?.prospectiveAssets.map((asset) => asset.assetId),
    ["story-new", "clip-new"]
  );
  assert.deepEqual(
    seen.assemblyRequests[0]?.preservedAssetIds,
    ["clip-preserved"]
  );
  assert.equal(seen.assemblyRequests[0]?.idempotencyKey, "idempotency:assembly-work");
});

test("assembly blocks missing prerequisites and rejects stale or extra bindings", async () => {
  const seen = observed();
  const clipBinding = output("visual-work", "clip");
  const visual: RerunWorkItem = {
    workItemId: "visual-work",
    owner: "visuals",
    kind: "revise_visuals",
    targets: [target],
    requiredOutputs: [clipBinding],
  };
  const assembly = work("assembly-work", "reassemble_cut", [
    output("assembly-work", "composite"),
  ]);
  const executor = createRootRerunExecutors(services(seen))[1];
  const waiting = await executor.execute(context({
    workItem: assembly,
    selectedWork: [visual, assembly],
    reserve: seen,
  }));
  assert.equal(waiting.status, "blocked");
  assert.equal(
    waiting.status === "blocked" ? waiting.precondition.kind : "",
    "prospective_bindings_incomplete"
  );

  const forged = completed(
    { ...clipBinding, role: "unapproved-role" },
    "clip-new"
  );
  await assert.rejects(
    executor.execute(context({
      workItem: assembly,
      selectedWork: [visual, assembly],
      resolved: [forged],
      reserve: seen,
    })),
    /outside the approved proposal/
  );
  const extra = completed(output("foreign-work", "clip"), "foreign-clip");
  await assert.rejects(
    executor.execute(context({
      workItem: assembly,
      selectedWork: [visual, assembly],
      resolved: [extra],
      reserve: seen,
    })),
    /was not approved/
  );
});

test("model-backed assembly failure settles recorded spend before terminal failure", async () => {
  const seen = observed();
  const clipBinding = output("visual-work", "clip");
  const visual: RerunWorkItem = {
    workItemId: "visual-work",
    owner: "visuals",
    kind: "revise_visuals",
    targets: [target],
    requiredOutputs: [clipBinding],
  };
  const assembly = work("assembly-work", "reassemble_cut", [
    output("assembly-work", "composite"),
  ]);
  const executor = createRootRerunExecutors(services(seen, {
    assembleProspectiveCut: async () => {
      throw new Error("selector failed after usage");
    },
    measuredActionCostUsd: async () => 0.04,
  }))[1];

  await assert.rejects(
    executor.execute(context({
      workItem: assembly,
      selectedWork: [visual, assembly],
      resolved: [completed(clipBinding, "clip-new")],
      reserve: seen,
    })),
    /selector failed/
  );
  assert.deepEqual(seen.settled.map((entry) => entry.actualUsd), [0.04]);
  assert.deepEqual(seen.released, []);
});

test("critique uses the prospective cut and exposes an inert successor identity", async () => {
  const seen = observed();
  const cutBinding = output("assembly-work", "composite");
  const assembly = work("assembly-work", "reassemble_cut", [cutBinding]);
  const critique = work("critique-work", "critique_cut", [
    output("critique-work", "critique"),
  ]);
  const executor = createRootRerunExecutors(services(seen))[2];
  const result = await executor.execute(context({
    workItem: critique,
    selectedWork: [assembly, critique],
    resolved: [completed(cutBinding, "cut-new")],
    reserve: seen,
  }));

  assert.equal(result.status, "succeeded");
  assert.equal(seen.critiqueRequests[0]?.prospectiveCutAssetId, "cut-new");
  assert.deepEqual(seen.reserved.map((entry) => entry.estimatedUsd), [0.05]);
  assert.deepEqual(seen.settled.map((entry) => entry.actualUsd), [0.02]);
  assert.deepEqual(
    result.status === "succeeded" ? result.primitiveActionIds : [],
    ["dispatch:critique-work"]
  );
  assert.deepEqual(
    result.status === "succeeded" ? result.providerResult : undefined,
    { followupProposalActionId: "proposal-followup" }
  );
});

test("zero-spend critique failure retains admission for idempotent replay", async () => {
  const seen = observed();
  const critique = work("critique-work", "critique_cut", [
    output("critique-work", "critique"),
  ]);
  let attempts = 0;
  const byKey = new Map<string, string>();
  const configured = services(seen, {
    critiqueProspectiveCut: async (request) => {
      attempts += 1;
      if (attempts === 1) throw new Error("critic unavailable");
      const assetId = byKey.get(request.idempotencyKey) ?? "critique-replayed";
      byKey.set(request.idempotencyKey, assetId);
      return {
        assetId,
        intrinsicRole: "timeline_critique",
        actualCostUsd: 0,
      };
    },
    estimateCritiqueUsd: () => 0,
  });
  const executor = createRootRerunExecutors(configured)[2];
  const value = context({
    workItem: critique,
    selectedWork: [critique],
    reserve: seen,
  });
  await assert.rejects(
    executor.execute(value),
    (error: unknown) =>
      error instanceof RetryableRerunExecutorError &&
      error.budgetReservationKeys.length === 1 &&
      /critic unavailable/.test(error.message)
  );
  assert.equal(seen.released.length, 0);
  assert.equal(seen.settled.length, 0);
  const replay = await executor.execute(value);
  assert.equal(replay.status, "succeeded");
  assert.equal(replay.status === "succeeded" ? replay.outputs[0]?.assetId : "", "critique-replayed");
  assert.equal(attempts, 2);
});

test("permanent zero-spend critique failure remains terminal", async () => {
  const seen = observed();
  const critique = work("critique-work", "critique_cut", [
    output("critique-work", "critique"),
  ]);
  const executor = createRootRerunExecutors(services(seen, {
    critiqueProspectiveCut: async () => {
      throw new ApiError(
        "validation_failed",
        "Prospective critique target is not a canonical timeline."
      );
    },
    estimateCritiqueUsd: () => 0,
  }))[2];

  await assert.rejects(
    executor.execute(context({
      workItem: critique,
      selectedWork: [critique],
      reserve: seen,
    })),
    (error: unknown) =>
      error instanceof ApiError && error.code === "validation_failed"
  );
  assert.equal(seen.released.length, 0);
  assert.equal(seen.settled.length, 0);
});

test("retry after a post-result settlement crash reuses one asset and one settlement", async () => {
  const seen = observed();
  const critique = work("critique-work", "critique_cut", [
    output("critique-work", "critique"),
  ]);
  const stagedByKey = new Map<string, string>();
  const durableSettlements = new Map<string, number>();
  let settlementCalls = 0;
  const configured = services(seen, {
    critiqueProspectiveCut: async (request) => {
      const assetId = stagedByKey.get(request.idempotencyKey) ?? "critique-staged";
      stagedByKey.set(request.idempotencyKey, assetId);
      return {
        assetId,
        intrinsicRole: "timeline_critique",
        actualCostUsd: 0.02,
      };
    },
    settleBudget: async ({ reservationKey, actualUsd }) => {
      settlementCalls += 1;
      const prior = durableSettlements.get(reservationKey);
      if (prior !== undefined && prior !== actualUsd) {
        throw new Error("settlement replay changed");
      }
      durableSettlements.set(reservationKey, actualUsd);
      if (settlementCalls === 1) {
        throw new ApiError(
          "database_error",
          "Database operation failed: orchestratorBudget.settle.",
          { dbCode: "08006", dbMessage: "connection lost after settlement commit" }
        );
      }
      return {} as never;
    },
  });
  const executor = createRootRerunExecutors(configured)[2];
  const value = context({
    workItem: critique,
    selectedWork: [critique],
    reserve: seen,
  });

  await assert.rejects(
    executor.execute(value),
    (error: unknown) =>
      error instanceof RetryableRerunExecutorError &&
      /settlement.*uncertain/i.test(error.message)
  );
  const replay = await executor.execute(value);

  assert.equal(replay.status, "succeeded");
  assert.equal(stagedByKey.size, 1);
  assert.equal(durableSettlements.size, 1);
  assert.equal(settlementCalls, 2);
});

for (const dbCode of ["23505", "55000", "P0002"] as const) {
  test(`deterministic settlement error ${dbCode} remains terminal`, async () => {
    const seen = observed();
    const critique = work("critique-work", "critique_cut", [
      output("critique-work", "critique"),
    ]);
    const executor = createRootRerunExecutors(services(seen, {
      settleBudget: async () => {
        throw new ApiError(
          "database_error",
          "Database operation failed: orchestratorBudget.settle.",
          {
            dbCode,
            dbMessage: dbCode === "23505"
              ? "budget_settlement_replay_mismatch for key critique"
              : "settlement reservation is not available",
          }
        );
      },
    }))[2];

    await assert.rejects(
      executor.execute(context({
        workItem: critique,
        selectedWork: [critique],
        reserve: seen,
      })),
      (error: unknown) =>
        error instanceof ApiError &&
        error.code === "database_error" &&
        error.details?.dbCode === dbCode
    );
  });
}

test("critique settles measured spend before rejecting an estimate overage", async () => {
  const seen = observed();
  const critique = work("critique-work", "critique_cut", [
    output("critique-work", "critique"),
  ]);
  const configured = services(seen, {
    critiqueProspectiveCut: async () => ({
      assetId: "critique-over-budget",
      intrinsicRole: "timeline_critique",
      actualCostUsd: 0.06,
    }),
    estimateCritiqueUsd: () => 0.05,
  });
  await assert.rejects(
    createRootRerunExecutors(configured)[2].execute(context({
      workItem: critique,
      selectedWork: [critique],
      reserve: seen,
    })),
    (error) => error instanceof ApiError && error.code === "budget_exceeded"
  );
  assert.deepEqual(seen.released, []);
  assert.deepEqual(seen.settled.map((entry) => entry.actualUsd), [0.06]);
});

test("critique will not consume an active cut without an exact asset pin", async () => {
  const seen = observed();
  const critique = work("critique-work", "critique_cut", [
    output("critique-work", "critique"),
  ]);
  const value = context({
    workItem: critique,
    selectedWork: [critique],
    reserve: seen,
  });
  value.proposal.pins.assets = value.proposal.pins.assets.filter(
    (pin) => pin.assetId !== "cut-old"
  );
  const result = await createRootRerunExecutors(services(seen))[2].execute(value);
  assert.equal(result.status, "blocked");
  assert.equal(seen.critiqueRequests.length, 0);
});

test("root executors reject missing and extra output bindings", async () => {
  const seen = observed();
  const story = work("story-work", "revise_story", []);
  const executor = createRootRerunExecutors(services(seen))[0];
  await assert.rejects(
    executor.execute(context({
      workItem: story,
      selectedWork: [story],
      reserve: seen,
    })),
    /exactly one story_snapshot binding/
  );

  const tooMany = work("story-work", "revise_story", [
    output("story-work", "story_snapshot", "story-1"),
    output("story-work", "story_snapshot", "story-2"),
  ]);
  await assert.rejects(
    executor.execute(context({
      workItem: tooMany,
      selectedWork: [tooMany],
      reserve: seen,
    })),
    /exactly one story_snapshot binding/
  );

  const registry = new RerunExecutorRegistry(createRootRerunExecutors(services(seen)));
  assert.doesNotThrow(() => registry.preflight([
    work("assembly-work", "reassemble_cut", [
      output("assembly-work", "composite"),
    ]),
  ]));
});
