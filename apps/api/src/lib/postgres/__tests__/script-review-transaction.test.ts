import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "@/core/errors";
import { decideScriptReviewTransaction } from "../script-review-transaction";

function transactionFixture(gateStatus = "reached") {
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
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("select id, status from public.script_drafts")) {
        return { rows: [{ id: "script-1", status: "draft" }], rowCount: 1 };
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
