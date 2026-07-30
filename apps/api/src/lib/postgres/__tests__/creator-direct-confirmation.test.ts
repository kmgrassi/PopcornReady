import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { ApiError } from "../../../core/errors.js";
import {
  createConfirmCreatorDirectProposal,
  type ConfirmCreatorDirectProposalInput,
  type TransactionRunner,
} from "../creator-direct-confirmation.js";

const input: ConfirmCreatorDirectProposalInput = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  projectId: "00000000-0000-4000-8000-000000000002",
  actorId: "00000000-0000-4000-8000-000000000003",
  gateId: "00000000-0000-4000-8000-000000000004",
  requestDigest: "a".repeat(64),
  approvedMaxUsd: 10,
  approvalToken: "creator-direct-token-1234",
  idempotencyKey: "confirm-key",
};
const runId = "00000000-0000-4000-8000-000000000005";
const actionId = "00000000-0000-4000-8000-000000000006";

type QueryStep = {
  name: string;
  rows?: QueryResultRow[];
  rowCount?: number;
  error?: Error & { code?: string };
};

function scriptedRunner(steps: QueryStep[]) {
  const observed: Array<{ sql: string; params: readonly unknown[] }> = [];
  let operation = "";
  let index = 0;
  const client = {
    async query(sql: string, params: readonly unknown[] = []) {
      const step = steps[index++];
      assert.ok(step, `unexpected query: ${sql}`);
      observed.push({ sql, params });
      if (step.error) throw step.error;
      return {
        rows: step.rows ?? [],
        rowCount: step.rowCount ?? step.rows?.length ?? 0,
        command: "",
        oid: 0,
        fields: [],
      } as QueryResult;
    },
  } as unknown as PoolClient;
  const runner: TransactionRunner = async (label, callback) => {
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

function gateRow(
  overrides: Partial<Record<string, unknown>> = {}
): QueryResultRow {
  return {
    valid: true,
    input_approved_max_usd_text: "10",
    orchestrator_run_id: runId,
    subject_proposal_action_id: actionId,
    status: "pending",
    token_consumed_at: null,
    ...overrides,
  };
}

function runRow(
  overrides: Partial<Record<string, unknown>> = {}
): QueryResultRow {
  return {
    id: runId,
    origin_kind: "creator_direct",
    status: "queued",
    ...overrides,
  };
}

function bodyHash(maximumText = "10"): string {
  return createHash("sha256")
    .update(
      `${input.gateId}:${input.actorId}:${input.requestDigest}:${maximumText}`
    )
    .digest("hex");
}

test("confirmation preserves authorization, lock, budget, wake, and idempotency order", async () => {
  const fixture = scriptedRunner([
    { name: "gate", rows: [gateRow()] },
    { name: "idempotency" },
    { name: "run", rows: [runRow()] },
    { name: "reserve", rows: [{ reservation_id: "reservation" }] },
    { name: "consume", rowCount: 1 },
    { name: "wake", rows: [{ wake_orchestrator_dispatch: null }] },
    { name: "record", rowCount: 1 },
  ]);

  const result = await createConfirmCreatorDirectProposal(fixture.runner)(input);

  assert.deepEqual(result, {
    runId,
    consumed: true,
    dispatchEnqueued: true,
  });
  assert.equal(fixture.operation(), "agentCreations.confirmProposal");
  assert.equal(fixture.remaining(), 0);
  assert.match(fixture.observed[0]!.sql, /for update of g/i);
  assert.deepEqual(fixture.observed[0]!.params.slice(0, 6), [
    input.gateId,
    input.projectId,
    input.actorId,
    input.requestDigest,
    input.workspaceId,
    input.approvedMaxUsd,
  ]);
  assert.match(fixture.observed[2]!.sql, /for update/i);
  assert.match(
    fixture.observed[3]!.sql,
    /reserve_orchestrator_run_budget/
  );
  assert.match(fixture.observed[5]!.sql, /wake_orchestrator_dispatch/);
  assert.equal(fixture.observed[6]!.params[2], bodyHash());
});

test("authorized idempotency replay returns the prior run before consumption checks", async () => {
  const fixture = scriptedRunner([
    {
      name: "gate",
      rows: [gateRow({ status: "approved", token_consumed_at: new Date() })],
    },
    {
      name: "idempotency",
      rows: [
        {
          body_hash: bodyHash(),
          response_body: {
            schemaVersion: "CreatorDirectConfirmation.v1",
            runId,
          },
        },
      ],
    },
  ]);

  const result = await createConfirmCreatorDirectProposal(fixture.runner)(input);
  assert.deepEqual(result, {
    runId,
    consumed: false,
    dispatchEnqueued: false,
  });
  assert.equal(fixture.remaining(), 0);
});

const failures: Array<{
  name: string;
  steps: QueryStep[];
  dbCode: string;
  dbMessage: string;
}> = [
  {
    name: "invalid or expired gate",
    steps: [{ name: "gate", rows: [gateRow({ valid: false })] }],
    dbCode: "23514",
    dbMessage: "creator_direct_confirmation_invalid",
  },
  {
    name: "idempotency conflict",
    steps: [
      { name: "gate", rows: [gateRow()] },
      {
        name: "idempotency",
        rows: [{ body_hash: "different", response_body: { runId } }],
      },
    ],
    dbCode: "23505",
    dbMessage: "creator_direct_confirmation_idempotency_conflict",
  },
  {
    name: "already-consumed gate with a new key",
    steps: [
      {
        name: "gate",
        rows: [gateRow({ status: "approved", token_consumed_at: new Date() })],
      },
      { name: "idempotency" },
    ],
    dbCode: "55000",
    dbMessage: "creator_direct_confirmation_already_consumed",
  },
  {
    name: "non-queued run",
    steps: [
      { name: "gate", rows: [gateRow()] },
      { name: "idempotency" },
      { name: "run", rows: [runRow({ status: "canceled" })] },
    ],
    dbCode: "23514",
    dbMessage: "creator_direct_gate_run_not_queued",
  },
  {
    name: "lost gate race",
    steps: [
      { name: "gate", rows: [gateRow()] },
      { name: "idempotency" },
      { name: "run", rows: [runRow()] },
      { name: "reserve" },
      { name: "consume", rowCount: 0 },
    ],
    dbCode: "55000",
    dbMessage: "creator_direct_confirmation_lost_race",
  },
];

for (const scenario of failures) {
  test(`${scenario.name} preserves the database_error contract`, async () => {
    const fixture = scriptedRunner(scenario.steps);
    await assert.rejects(
      createConfirmCreatorDirectProposal(fixture.runner)(input),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.code, "database_error");
        assert.equal(error.details?.operation, "agentCreations.confirmProposal");
        assert.equal(error.details?.dbCode, scenario.dbCode);
        assert.equal(error.details?.dbMessage, scenario.dbMessage);
        return true;
      }
    );
  });
}

test("raw pg failures retain safe code, detail, and hint metadata", async () => {
  const pgError = Object.assign(new Error("permission denied"), {
    code: "42501",
    detail: "role lacks a required grant",
    hint: "apply the confirmation role migration",
  });
  const fixture = scriptedRunner([{ name: "gate", error: pgError }]);

  await assert.rejects(
    createConfirmCreatorDirectProposal(fixture.runner)(input),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "database_error");
      assert.equal(error.details?.dbCode, "42501");
      assert.equal(error.details?.dbDetails, pgError.detail);
      assert.equal(error.details?.dbHint, pgError.hint);
      return true;
    }
  );
});
