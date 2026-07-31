import assert from "node:assert/strict";
import test from "node:test";
import type { RerunProposalV2 } from "@popcorn/shared/rerun-proposal";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import {
  createApproveRerunProposalTransaction,
  createRejectRerunProposalTransaction,
  createRerunProposalSuccessorTransaction,
  type RerunProposalTransactionRunner,
} from "../rerun-proposal-transactions.js";

const projectId = "00000000-0000-4000-8000-000000000001";
const priorActionId = "00000000-0000-4000-8000-000000000002";
const successorActionId = "00000000-0000-4000-8000-000000000003";
const approvalActionId = "00000000-0000-4000-8000-000000000004";
const rootRunId = "00000000-0000-4000-8000-000000000005";

const proposal = {
  schemaVersion: "RerunProposal.v2",
  projectId,
  rootRunId,
  source: "request_changes",
  userIntent: "Tighten the scene.",
  targets: [],
  inspectedAssetIds: [],
  candidateAffectedAssetIds: [],
  preservedAssetIds: [],
  checklist: [],
  pins: { assets: [], selections: [], storySnapshots: [] },
  estimate: { costUsd: 1, maxCostUsd: 2, latencyClass: "interactive" },
  risk: "low",
  requiresApproval: true,
  rationale: "Creator requested a revision.",
  userFacingSummary: "Tighten the scene.",
  outcome: "revision",
  selectedWork: [
    {
      workItemId: "work-1",
      owner: "creative_director",
      kind: "revise_story",
      targets: [],
      requiredOutputs: [],
    },
  ],
  plannedSelectionMoves: [],
  plannedStoryPointerMoves: [],
} as RerunProposalV2;

type Step = {
  rows?: QueryResultRow[];
  rowCount?: number;
};

function scriptedRunner(steps: Step[]) {
  const observed: Array<{ sql: string; params: readonly unknown[] }> = [];
  let operation = "";
  let index = 0;
  const client = {
    async query(sql: string, params: readonly unknown[] = []) {
      const step = steps[index++];
      assert.ok(step, `unexpected query: ${sql}`);
      observed.push({ sql, params });
      return {
        rows: step.rows ?? [],
        rowCount: step.rowCount ?? step.rows?.length ?? 0,
        command: "",
        oid: 0,
        fields: [],
      } as QueryResult;
    },
  } as unknown as PoolClient;
  const runner: RerunProposalTransactionRunner = async (label, callback) => {
    operation = label;
    return callback(client);
  };
  return {
    runner,
    observed,
    operation: () => operation,
    remaining: () => steps.length - index,
  };
}

function proposalRow(
  status: string,
  value: RerunProposalV2 = proposal
): QueryResultRow {
  return {
    id: priorActionId,
    orchestrator_run_id: rootRunId,
    status,
    tool: "rerun_proposal",
    proposal: value,
  };
}

test("approval runs the lock, freshness check, insert, and transition inside one typed transaction", async () => {
  const fixture = scriptedRunner([
    { rows: [proposalRow("proposed")] },
    {},
    {},
    {},
    {},
    { rowCount: 1 },
    { rowCount: 1 },
  ]);
  const result = await createApproveRerunProposalTransaction(fixture.runner)({
    projectId,
    proposalActionId: priorActionId,
    approvalActionId,
    actorId: "creator-1",
    approvedMaxCostUsd: 2,
    approvalFingerprint: "fingerprint",
    autonomous: false,
  });

  assert.deepEqual(result, {
    proposal_status: "approved",
    approval_action_id: approvalActionId,
    replayed: false,
    stale: false,
  });
  assert.equal(fixture.operation(), "rerunLifecycleStore.approve");
  assert.equal(fixture.remaining(), 0);
  assert.match(fixture.observed[0]!.sql, /from public\.actions[\s\S]*for update/i);
  assert.match(fixture.observed[2]!.sql, /savepoint rerun_freshness/i);
  assert.match(
    fixture.observed[3]!.sql,
    /assert_rerun_proposal_pins_fresh/i
  );
  assert.match(fixture.observed[5]!.sql, /insert into public\.actions/i);
  assert.match(fixture.observed[6]!.sql, /status = 'approved'/i);
  assert.equal(
    fixture.observed.some(({ sql }) =>
      /approve_rerun_proposal\s*\(/i.test(sql)
    ),
    false
  );
});

test("rejection replay is idempotent while retaining the proposal row lock", async () => {
  const fixture = scriptedRunner([{ rows: [proposalRow("rejected")] }]);
  const result = await createRejectRerunProposalTransaction(fixture.runner)({
    projectId,
    proposalActionId: priorActionId,
  });

  assert.equal(result, "rejected");
  assert.equal(fixture.remaining(), 0);
  assert.match(fixture.observed[0]!.sql, /for update/i);
  assert.equal(
    fixture.observed.some(({ sql }) => /reject_rerun_proposal\s*\(/i.test(sql)),
    false
  );
});

test("successor creation atomically records causation before superseding the prior proposal", async () => {
  const successor = {
    ...proposal,
    outcome: "no_op",
    requiresApproval: false,
    selectedWork: [],
  } as RerunProposalV2;
  const fixture = scriptedRunner([
    { rows: [proposalRow("proposed")] },
    {},
    { rowCount: 1 },
    { rowCount: 1 },
    { rowCount: 1 },
  ]);
  const result = await createRerunProposalSuccessorTransaction(fixture.runner)({
    projectId,
    priorActionId,
    successorActionId,
    requestFingerprint: "refresh-fingerprint",
    cause: "refresh",
    rootRunId,
    params: { schemaVersion: "RerunProposalRequest.v1" },
    proposal: successor,
    inputAssetIds: [],
    rationale: "Pins changed.",
  });

  assert.deepEqual(result, {
    successor_action_id: successorActionId,
    replayed: false,
  });
  assert.equal(fixture.remaining(), 0);
  assert.match(
    fixture.observed[2]!.sql,
    /'rerun_proposal',[\s\S]*\$4::public\.action_status/i
  );
  assert.equal(fixture.observed[2]!.params[3], "applied");
  assert.match(
    fixture.observed[3]!.sql,
    /insert into public\.rerun_proposal_successors/i
  );
  assert.match(fixture.observed[4]!.sql, /proposal_superseded/i);
  assert.equal(
    fixture.observed.some(({ sql }) =>
      /create_rerun_proposal_successor\s*\(/i.test(sql)
    ),
    false
  );
});
