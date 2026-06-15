import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "../errors";
import {
  approveReviewGate,
  cancelGenerationRun,
  createRunWithSeedStages,
  createSupabaseGenerationRunsStore,
  rejectReviewGate,
} from "../generation-runs";
import {
  CHECK_VIOLATION,
  firstJsonbViolation,
  hasSchemaMarker,
  isStringArray,
  jsonbTypeof,
} from "../../supabase/jsonb-constraints";

// Why this file exists:
//
// The offline file store (createGenerationRunsStore) dumps the camelCase
// GenerationRun straight to disk — it never runs runToRow/runStateFromRun, so the
// `gates` JSONB shape that Postgres validates is produced ONLY by the Supabase
// store. That left the production serialization path untested, which is exactly
// how a `gates` payload that violates generation_runs_gates_schema_check (the
// `{"v": "generationRunState.v1", ...}` marker bug) shipped: every offline test
// passed because no test ever exercised the constraint-bearing write path.
//
// This suite closes that gap. A faithful in-memory Supabase fake enforces the
// real CHECK constraints (via ../../supabase/jsonb-constraints) on every
// insert/update, so the *production* store and the high-level orchestration
// entry points run against the same guardrails the database imposes. A bad
// payload now fails here instead of at runtime.

// ---------------------------------------------------------------------------
// In-memory Supabase fake for a single constraint-guarded table.
//
// Implements just the query-builder surface createSupabaseGenerationRunsStore
// uses: from().select/insert/update/eq/order/single/maybeSingle, awaited either
// via single()/maybeSingle() or directly (order() is a thenable terminal).
// Inserts/updates are validated against firstJsonbViolation; a violation resolves
// to a Postgres-shaped { code: "23514", ... } error, which the store turns into
// an ApiError("database_error") just like production.
// ---------------------------------------------------------------------------

interface PgResult<T> {
  data: T;
  error: { code: string; message: string; details?: string } | null;
}

function checkViolationError(table: string, column: string, constraint: string) {
  return {
    code: CHECK_VIOLATION,
    message: `new row for relation "${table}" violates check constraint "${constraint}"`,
    details: `Failing row contains the value rejected by ${column}.`,
  };
}

class FakeQuery<Row extends Record<string, unknown>> implements PromiseLike<PgResult<Row[]>> {
  private op: "select" | "insert" | "update" = "select";
  private payload: Partial<Row> | null = null;
  private readonly filters: Array<[string, unknown]> = [];
  private orderBy: { column: string; ascending: boolean } | null = null;

  constructor(
    private readonly table: string,
    private readonly rows: Map<string, Row>
  ) {}

  select(_columns?: string): this {
    return this;
  }

  insert(payload: Partial<Row>): this {
    this.op = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Partial<Row>): this {
    this.op = "update";
    this.payload = payload;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: opts?.ascending !== false };
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every(([column, value]) => row[column] === value);
  }

  private validate(row: Record<string, unknown>): PgResult<Row[]> | null {
    const violation = firstJsonbViolation(this.table, row);
    if (!violation) return null;
    return {
      data: [],
      error: checkViolationError(this.table, violation.column, violation.constraint),
    };
  }

  private run(): PgResult<Row[]> {
    if (this.op === "insert") {
      const row = { id: randomUUID(), ...(this.payload as Row) };
      const failed = this.validate(row);
      if (failed) return failed;
      this.rows.set(row.id as string, row);
      return { data: [row], error: null };
    }
    if (this.op === "update") {
      const updated: Row[] = [];
      for (const [id, row] of this.rows) {
        if (!this.matches(row)) continue;
        const next = { ...row, ...(this.payload as Partial<Row>) };
        const failed = this.validate(next);
        if (failed) return failed;
        this.rows.set(id, next);
        updated.push(next);
      }
      return { data: updated, error: null };
    }
    // select
    let result = [...this.rows.values()].filter((row) => this.matches(row));
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      result = result.sort((a, b) => {
        const av = a[column] as string;
        const bv = b[column] as string;
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
      });
    }
    return { data: result, error: null };
  }

  async single(): Promise<PgResult<Row | null>> {
    const { data, error } = this.run();
    if (error) return { data: null, error };
    if (data.length === 0) {
      return { data: null, error: { code: "PGRST116", message: "no rows" } };
    }
    return { data: data[0], error: null };
  }

  async maybeSingle(): Promise<PgResult<Row | null>> {
    const { data, error } = this.run();
    if (error) return { data: null, error };
    return { data: data[0] ?? null, error: null };
  }

  then<TResult1 = PgResult<Row[]>, TResult2 = never>(
    onfulfilled?:
      | ((value: PgResult<Row[]>) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

function createFakeSupabase(): SupabaseClient {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();
  return {
    from(table: string) {
      let rows = tables.get(table);
      if (!rows) {
        rows = new Map();
        tables.set(table, rows);
      }
      return new FakeQuery(table, rows);
    },
  } as unknown as SupabaseClient;
}

function supabaseStore() {
  return createSupabaseGenerationRunsStore(createFakeSupabase());
}

// Read back the raw persisted `gates` JSONB for a run so a test can assert the
// stored shape, not just the round-tripped GenerationRun.
async function readGatesColumn(
  db: SupabaseClient,
  runId: string
): Promise<Record<string, unknown>> {
  const { data, error } = await db
    .from("generation_runs")
    .select("*")
    .eq("id", runId)
    .single();
  assert.equal(error, null);
  return (data as { gates: Record<string, unknown> }).gates;
}

// ---------------------------------------------------------------------------
// The fake must reject exactly what Postgres rejects, or the suite proves
// nothing. Pin the constraint predicate against every branch of the SQL.
// ---------------------------------------------------------------------------

test("jsonb-constraints: gates accepts a schema_version-marked object", () => {
  const gates = { schema_version: "generationRunState.v1", stages: [], reviewGate: null };
  assert.equal(hasSchemaMarker(gates), true);
  assert.equal(firstJsonbViolation("generation_runs", { gates }), null);
});

test("jsonb-constraints: gates accepts a `schema`-marked object", () => {
  const gates = { schema: "generationRunState.v1", stages: [] };
  assert.equal(firstJsonbViolation("generation_runs", { gates }), null);
});

test("jsonb-constraints: gates accepts the flat string-array bridge (incl. empty)", () => {
  assert.equal(isStringArray([]), true);
  assert.equal(isStringArray(["creative_plan", "storyboard"]), true);
  assert.equal(firstJsonbViolation("generation_runs", { gates: [] }), null);
  assert.equal(
    firstJsonbViolation("generation_runs", { gates: ["creative_plan"] }),
    null
  );
});

test("jsonb-constraints: gates REJECTS the legacy `v`-marker object (the shipped bug)", () => {
  const gates = { v: "generationRunState.v1", stages: [], reviewGate: null };
  assert.equal(hasSchemaMarker(gates), false);
  const violation = firstJsonbViolation("generation_runs", { gates });
  assert.equal(violation?.constraint, "generation_runs_gates_schema_check");
});

test("jsonb-constraints: gates REJECTS a non-string array and a plain object", () => {
  assert.equal(isStringArray(["ok", 7]), false);
  assert.ok(firstJsonbViolation("generation_runs", { gates: ["ok", 7] }));
  assert.ok(firstJsonbViolation("generation_runs", { gates: { stages: [] } }));
});

test("jsonb-constraints: jsonbTypeof distinguishes null/array/object like Postgres", () => {
  assert.equal(jsonbTypeof(null), "null");
  assert.equal(jsonbTypeof([]), "array");
  assert.equal(jsonbTypeof({}), "object");
  assert.equal(jsonbTypeof("x"), "string");
  assert.equal(jsonbTypeof(1), "number");
  assert.equal(jsonbTypeof(true), "boolean");
});

test("jsonb-constraints: asset/action document columns require a schema marker", () => {
  // Positive: marked payloads pass.
  assert.equal(
    firstJsonbViolation("assets", { content: { schema_version: "brief.v1" } }),
    null
  );
  assert.equal(firstJsonbViolation("assets", { params: {} }), null); // empty params sentinel
  assert.equal(firstJsonbViolation("actions", { params: {} }), null);
  // Negative: unmarked objects are rejected on the right constraint.
  assert.equal(
    firstJsonbViolation("assets", { content: { brief: "hi" } })?.constraint,
    "assets_content_schema_check"
  );
  assert.equal(
    firstJsonbViolation("actions", { proposal: { plan: {} } })?.constraint,
    "actions_proposal_schema_check"
  );
});

// ---------------------------------------------------------------------------
// Production store write paths — every call that persists `gates` must satisfy
// generation_runs_gates_schema_check. Before the fix these threw
// ApiError("database_error", dbCode 23514).
// ---------------------------------------------------------------------------

test("createRun persists a constraint-valid, schema-marked gates payload", async () => {
  const db = createFakeSupabase();
  const store = createSupabaseGenerationRunsStore(db);

  const run = await store.createRun({ projectId: "proj_a", status: "queued" });

  assert.equal(run.status, "queued");
  const gates = await readGatesColumn(db, run.runId);
  assert.equal(gates.schema_version, "generationRunState.v1");
  assert.equal(firstJsonbViolation("generation_runs", { gates }), null);
});

test("createRun with review-gate fields stays constraint-valid", async () => {
  const db = createFakeSupabase();
  const store = createSupabaseGenerationRunsStore(db);

  const run = await store.createRun({
    projectId: "proj_a",
    status: "queued",
    briefVersionId: "brief_1",
    reviewGates: ["creative_plan"],
    reviewGate: null,
    currentStageType: "brief_intake",
  });

  const gates = await readGatesColumn(db, run.runId);
  assert.equal(firstJsonbViolation("generation_runs", { gates }), null);
  const read = await store.getRun(run.runId);
  assert.deepEqual(read?.reviewGates, ["creative_plan"]);
});

test("updateRun rewrites gates while staying constraint-valid", async () => {
  const db = createFakeSupabase();
  const store = createSupabaseGenerationRunsStore(db);
  const run = await store.createRun({ projectId: "proj_a", status: "queued" });

  await store.updateRun(run.runId, {
    status: "running",
    reviewGate: {
      stageType: "creative_plan",
      stageId: `${run.runId}:creative_plan`,
      state: "awaiting_review",
      enteredAt: new Date().toISOString(),
    },
    reviewFeedback: "looks good",
  });

  const gates = await readGatesColumn(db, run.runId);
  assert.equal(firstJsonbViolation("generation_runs", { gates }), null);
  const read = await store.getRun(run.runId);
  assert.equal(read?.status, "running");
  assert.equal(read?.reviewGate?.stageType, "creative_plan");
});

test("saveStage / saveStageItem / saveStageArtifact keep gates constraint-valid", async () => {
  const db = createFakeSupabase();
  const store = createSupabaseGenerationRunsStore(db);
  const run = await store.createRun({ projectId: "proj_a", status: "running" });

  const stage = await store.saveStage({
    runId: run.runId,
    type: "creative_plan",
    label: "Creative plan",
    order: 0,
    status: "queued",
    jobIds: [],
    artifactIds: [],
  });
  const item = await store.saveStageItem({
    stageId: stage.stageId,
    kind: "plan",
    status: "queued",
  });
  await store.saveStageArtifact({
    runId: run.runId,
    stageId: stage.stageId,
    itemId: item.itemId,
    kind: "plan",
    content: { schema_version: "plan.v1", beats: [] },
  });
  await store.updateStage(stage.stageId, { status: "succeeded", progressPercent: 100 });
  await store.updateStageItem(item.itemId, { status: "succeeded" });

  const gates = await readGatesColumn(db, run.runId);
  assert.equal(firstJsonbViolation("generation_runs", { gates }), null);
  const stages = await store.listStagesForRun(run.runId);
  assert.equal(stages.find((s) => s.stageId === stage.stageId)?.status, "succeeded");
});

// ---------------------------------------------------------------------------
// High-level orchestration entry points (the API/orchestrator call surface).
// These chain many gates writes; a single intermediate shape drift would throw.
// ---------------------------------------------------------------------------

test("createRunWithSeedStages seeds a run + stages with constraint-valid gates", async () => {
  const db = createFakeSupabase();
  const store = createSupabaseGenerationRunsStore(db);

  const payload = await createRunWithSeedStages({
    store,
    projectId: "proj_seed",
    body: { reviewGates: ["creative_plan"] },
  });

  assert.equal(payload.run.status, "queued");
  assert.ok(payload.stages.length > 0);
  const gates = await readGatesColumn(db, payload.run.runId);
  assert.equal(firstJsonbViolation("generation_runs", { gates }), null);
});

test("approve and reject review-gate flows persist constraint-valid gates throughout", async () => {
  const db = createFakeSupabase();
  const store = createSupabaseGenerationRunsStore(db);
  const { run, stages } = await createRunWithSeedStages({
    store,
    projectId: "proj_flow",
    body: { reviewGates: ["creative_plan"] },
  });

  const gateStage = stages.find((s) => s.type === "creative_plan");
  assert.ok(gateStage);

  // Drive the run into awaiting_review on the gated stage, then approve.
  await store.updateStage(gateStage.stageId, { status: "succeeded" });
  await store.updateRun(run.runId, {
    status: "running",
    reviewGate: {
      stageType: "creative_plan",
      stageId: gateStage.stageId,
      state: "awaiting_review",
      enteredAt: new Date().toISOString(),
    },
  });

  await approveReviewGate(store, run.runId, { note: "ship it" });
  let gates = await readGatesColumn(db, run.runId);
  assert.equal(firstJsonbViolation("generation_runs", { gates }), null);
  assert.equal((await store.getRun(run.runId))?.reviewGate, null);

  // Re-enter review, then reject — reject resets stage/items and clears the gate.
  await store.updateRun(run.runId, {
    status: "running",
    reviewGate: {
      stageType: "creative_plan",
      stageId: gateStage.stageId,
      state: "awaiting_review",
      enteredAt: new Date().toISOString(),
    },
  });
  await rejectReviewGate(store, run.runId, { note: "redo the hook" });
  gates = await readGatesColumn(db, run.runId);
  assert.equal(firstJsonbViolation("generation_runs", { gates }), null);
  assert.equal((await store.getRun(run.runId))?.reviewGate, null);
});

test("cancelGenerationRun persists a constraint-valid terminal gates payload", async () => {
  const db = createFakeSupabase();
  const store = createSupabaseGenerationRunsStore(db);
  const { run } = await createRunWithSeedStages({
    store,
    projectId: "proj_cancel",
    body: {},
  });

  await cancelGenerationRun(store, run.runId);

  const gates = await readGatesColumn(db, run.runId);
  assert.equal(firstJsonbViolation("generation_runs", { gates }), null);
  assert.equal((await store.getRun(run.runId))?.status, "canceled");
});

// ---------------------------------------------------------------------------
// Regression guard: a store that emits the legacy `v` marker must be rejected by
// the fake exactly as Postgres rejected it (dbCode 23514). This pins the precise
// failure mode so a reintroduction is caught here, not in production.
// ---------------------------------------------------------------------------

test("a gates payload missing the schema marker is rejected with dbCode 23514", async () => {
  const db = createFakeSupabase();
  // Insert a legacy-shaped row directly through the fake to prove the guardrail
  // fires on the exact payload that broke production.
  const { error } = await db
    .from("generation_runs")
    .insert({
      project_id: "proj_legacy",
      status: "queued",
      gates: { v: "generationRunState.v1", stages: [], reviewGate: null },
    })
    .select("*")
    .single();

  assert.equal(error?.code, CHECK_VIOLATION);
  assert.match(error?.message ?? "", /generation_runs_gates_schema_check/);
});
