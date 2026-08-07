import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "@/core/errors";
import { decideScriptReviewTransaction } from "../script-review-transaction";

function transactionFixture(gateStatus = "reached", scriptBlueprintId = "blueprint-1") {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const transaction = async <T>(
    _operation: string,
    callback: (client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<T>,
  ): Promise<T> => callback({
    query: async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes("select g.status")) {
        return {
          rows: [{
            gate_status: gateStatus,
            stage: "after:draft_script",
            script_draft_id: "script-1",
            story_blueprint_id: "blueprint-1",
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("select id, status, story_blueprint_id from public.script_drafts")) {
        return { rows: [{ id: "script-1", status: "draft", story_blueprint_id: scriptBlueprintId }], rowCount: 1 };
      }
      return { rows: [{ id: "script-1" }], rowCount: 1 };
    },
  } as never);
  return { transaction, queries };
}

const base = {
  workspaceId: "workspace-1",
  projectId: "project-1",
  runId: "run-1",
  gateId: "gate-1",
  scriptDraftId: "script-1",
} as const;

test("script approval locks identity and updates draft, gate, and run in one transaction", async () => {
  const fixture = transactionFixture();
  await decideScriptReviewTransaction(
    { ...base, decision: "approved" },
    fixture.transaction as never,
  );

  assert.match(fixture.queries[0]!.sql, /for update of g, r, p/i);
  assert.equal(fixture.queries.some(({ sql }) => /update public\.script_drafts/i.test(sql)), true);
  assert.equal(fixture.queries.some(({ sql }) => /update public\.orchestrator_run_gates/i.test(sql)), true);
  assert.equal(fixture.queries.some(({ sql }) => /update public\.orchestrator_runs/i.test(sql)), true);
});

test("script-only approval completes the run inside the review transaction", async () => {
  const fixture = transactionFixture();
  await decideScriptReviewTransaction(
    { ...base, decision: "approved", completeRun: true },
    fixture.transaction as never,
  );
  const runUpdate = fixture.queries.find(({ sql }) => /update public\.orchestrator_runs/i.test(sql));
  assert.equal(runUpdate?.params?.[1], "succeeded");
  assert.match(runUpdate?.sql ?? "", /completed_at = case/i);
});

test("script-only approval rejects a script authored from a stale outline", async () => {
  const fixture = transactionFixture("reached", "blueprint-old");
  await assert.rejects(
    decideScriptReviewTransaction(
      { ...base, decision: "approved", completeRun: true },
      fixture.transaction as never,
    ),
    (error: unknown) => error instanceof ApiError && error.code === "stale_proposal",
  );
});

test("script-only revision rejects feedback against a stale outline", async () => {
  const fixture = transactionFixture("reached", "blueprint-old");
  await assert.rejects(
    decideScriptReviewTransaction(
      { ...base, decision: "rejected", note: "Change the ending.", completeRun: true },
      fixture.transaction as never,
    ),
    (error: unknown) => error instanceof ApiError && error.code === "stale_proposal",
  );
  assert.equal(
    fixture.queries.some(({ sql }) => /insert into public\.actions/i.test(sql)),
    false,
  );
});

test("a second script decision loses the reached-state compare-and-set", async () => {
  const fixture = transactionFixture("approved");
  await assert.rejects(
    decideScriptReviewTransaction(
      { ...base, decision: "rejected", note: "Try again." },
      fixture.transaction as never,
    ),
    (error: unknown) => error instanceof ApiError && error.code === "stale_proposal",
  );
  assert.equal(fixture.queries.length, 1);
});

test("script rejection stores a schema-marked board revision request", async () => {
  const fixture = transactionFixture();
  await decideScriptReviewTransaction(
    { ...base, decision: "rejected", note: "Make Maya more suspicious." },
    fixture.transaction as never,
  );

  const insert = fixture.queries.find(({ sql }) =>
    /insert into public\.actions/i.test(sql)
  );
  assert.ok(insert);
  assert.deepEqual(JSON.parse(String(insert.params?.[3])), {
    schema_version: "action_params.v1",
    schemaVersion: "board_revision_request.v1",
    message: "Make Maya more suspicious.",
    target: { scope: "script", scriptDraftId: "script-1" },
  });
});
