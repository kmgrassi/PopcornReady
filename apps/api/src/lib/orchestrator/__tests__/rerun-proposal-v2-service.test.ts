import assert from "node:assert/strict";
import test from "node:test";
import type { CreateActionInput } from "@/lib/api/v1/store-types";
import { ApiError } from "@/core/errors";
import type { RerunDecisionPacket } from "../rerun-decision-context";
import { createRerunProposalV2 } from "../rerun-proposal-v2-service";

const root = {
  id: "root",
  schemaVersion: "orchestrator_run.v1" as const,
  projectId: "p",
  status: "waiting" as const,
  inputSummary: "test",
  agentRole: "creative_director" as const,
  spentUsd: 0,
  createdAt: "now",
  updatedAt: "now",
};

const packet: RerunDecisionPacket = {
  schemaVersion: "RerunDecisionPacket.v1",
  projectId: "p",
  rootRun: { id: "root", status: "waiting", spentUsd: 0, budgetUsd: null },
  userIntent: "Already bright enough",
  targets: [{ kind: "project", projectId: "p" }],
  assets: [],
  candidateAffectedAssetIds: [],
  relatedAssetIds: [],
  story: { blueprint: null, storyboards: [], scenes: [], beats: [], panels: [] },
  timelineItems: [],
  transcriptSegments: [],
  recentActions: [],
  terminalDomainReports: [],
  capabilities: [],
  pins: { assets: [], selections: [], storySnapshots: [] },
  truncation: {
    assets: false, downstreamCandidates: false, relatedAssets: false,
    actions: false, terminalReports: false, storyRows: false,
    timelineItems: false, transcriptSegments: false,
    assetInputs: false, selectionRefs: false, selectionPins: false,
  },
};

function deps(overrides: Record<string, unknown> = {}) {
  return {
    authorizeProject: async () => ({ id: "p" }) as never,
    getRun: async () => root,
    listRuns: async () => [root],
    loadPacket: async () => packet,
    decide: async () => ({
      outcome: "no_op" as const,
      selectedWork: [] as [],
      preservedAssetIds: [],
      rationale: "No change is needed.",
      userFacingSummary: "The current state already matches.",
      checklist: [{
        target: { kind: "project" as const, projectId: "p" },
        decision: "preserve" as const,
        reason: "Already satisfies the request.",
      }],
    }),
    createAction: async () => ({ id: "proposal-action" }) as never,
    ...overrides,
  };
}

test("inert v2 preview persists one immutable action and performs no enqueue or selection write", async () => {
  let persisted: CreateActionInput | undefined;
  let packetLoads = 0;
  const result = await createRerunProposalV2({
    workspaceId: "w",
    projectId: "p",
    source: "request_changes",
    message: "Already bright enough",
    targets: [{ kind: "project", projectId: "p" }],
    rootRunId: "root",
  }, deps({
    loadPacket: async () => { packetLoads += 1; return packet; },
    createAction: async (input: CreateActionInput) => {
      persisted = input;
      return { id: "proposal-action" } as never;
    },
  }));
  assert.equal(packetLoads, 1);
  assert.equal(result.actionId, "proposal-action");
  assert.equal(result.proposal.outcome, "no_op");
  assert.equal(persisted?.tool, "rerun_proposal");
  assert.equal(persisted?.status, "applied");
  assert.equal(persisted?.params?.schemaVersion, "rerun_proposal_request.v2");
});

test("workspace authorization and root mismatch fail before packet/model/action writes", async () => {
  let packetLoads = 0;
  let decisions = 0;
  let writes = 0;
  await assert.rejects(() => createRerunProposalV2({
    workspaceId: "wrong",
    projectId: "p",
    source: "request_changes",
    message: "x",
    targets: [{ kind: "project", projectId: "p" }],
  }, deps({
    authorizeProject: async () => { throw new Error("not authorized"); },
    loadPacket: async () => { packetLoads += 1; return packet; },
    decide: async () => { decisions += 1; throw new Error("must not decide"); },
    createAction: async () => { writes += 1; return {} as never; },
  })), /not authorized/);
  assert.deepEqual([packetLoads, decisions, writes], [0, 0, 0]);

  await assert.rejects(() => createRerunProposalV2({
    workspaceId: "w",
    projectId: "p",
    source: "request_changes",
    message: "x",
    targets: [{ kind: "project", projectId: "p" }],
    rootRunId: "flat",
  }, deps({
    getRun: async () => ({ ...root, agentRole: "visuals" as const }),
    loadPacket: async () => { packetLoads += 1; return packet; },
    createAction: async () => { writes += 1; return {} as never; },
  })), /Creative Director root/);
  assert.deepEqual([packetLoads, writes], [0, 0]);

  await assert.rejects(() => createRerunProposalV2({
    workspaceId: "w",
    projectId: "p",
    source: "request_changes",
    message: "x",
    targets: [{ kind: "project", projectId: "p" }],
    rootRunId: "terminal",
  }, deps({
    getRun: async () => ({ ...root, status: "succeeded" as const }),
    loadPacket: async () => { packetLoads += 1; return packet; },
    createAction: async () => { writes += 1; return {} as never; },
  })), /Creative Director root/);
  assert.deepEqual([packetLoads, writes], [0, 0]);
});

test("project-scoped preview without an active root persists unbound and creates no ghost run", async () => {
  let createdRuns = 0;
  let persisted: CreateActionInput | undefined;
  const unboundPacket: RerunDecisionPacket = {
    ...packet,
    rootRun: { id: null, status: "unbound", spentUsd: 0, budgetUsd: null },
  };
  const result = await createRerunProposalV2({
    workspaceId: "w",
    projectId: "p",
    source: "autonomous_review",
    message: "Review",
    targets: [{ kind: "project", projectId: "p" }],
  }, deps({
    listRuns: async () => [],
    createRun: async () => { createdRuns += 1; return root; },
    loadPacket: async (input: { rootRunId?: string }) => {
      assert.equal(input.rootRunId, undefined);
      return unboundPacket;
    },
    createAction: async (input: CreateActionInput) => {
      persisted = input;
      return { id: "proposal-action" } as never;
    },
  }));
  assert.equal(createdRuns, 0);
  assert.equal(result.proposal.rootRunId, null);
  assert.equal(persisted?.orchestratorRunId, undefined);
});

test("invalid model output becomes a typed upstream failure and never writes an action", async () => {
  let writes = 0;
  await assert.rejects(() => createRerunProposalV2({
    workspaceId: "w",
    projectId: "p",
    source: "request_changes",
    message: "Review",
    targets: [{ kind: "project", projectId: "p" }],
  }, deps({
    decide: async () => {
      throw new ApiError("validation_failed", "invented target");
    },
    createAction: async () => {
      writes += 1;
      return {} as never;
    },
  })), (error: unknown) =>
    error instanceof ApiError && error.code === "model_output_invalid");
  assert.equal(writes, 0);
});
