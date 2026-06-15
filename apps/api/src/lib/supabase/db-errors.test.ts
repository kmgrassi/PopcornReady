import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiError } from "../../core/errors";
import {
  databaseError,
  isMissingRow,
  runQuery,
  throwDatabaseError,
} from "./db-errors";

// A resolved promise matching the supabase-js builder shape ({ data, error }).
// supabase-js builders are thenable, and a Promise satisfies PromiseLike.
function fakeQuery<T>(result: {
  data: T;
  error: { code?: string; message?: string } | null;
}): PromiseLike<{ data: T; error: { code?: string; message?: string } | null }> {
  return Promise.resolve(result);
}

const silentLogger = { error() {} };

test("isMissingRow recognizes PostgREST no-row responses", () => {
  assert.equal(isMissingRow({ code: "PGRST116" }), true);
  assert.equal(isMissingRow({ code: "23505" }), false);
  assert.equal(isMissingRow(null), false);
});

test("databaseError preserves operation and Supabase details in the API envelope", () => {
  const err = databaseError("store.createProject insert project", {
    code: "23503",
    message: "insert or update on table violates foreign key constraint",
    details: "Key is not present in table.",
    hint: "Check the workspace id.",
  });

  assert.equal(err.code, "database_error");
  assert.equal(err.status, 500);
  assert.equal(err.message, "Database operation failed: store.createProject insert project.");
  assert.deepEqual(err.details, {
    operation: "store.createProject insert project",
    dbCode: "23503",
    dbMessage: "insert or update on table violates foreign key constraint",
    dbDetails: "Key is not present in table.",
    dbHint: "Check the workspace id.",
  });
});

test("throwDatabaseError throws ApiError only when Supabase returned an error", () => {
  assert.doesNotThrow(() => throwDatabaseError("store.listProjects", null));

  assert.throws(
    () => throwDatabaseError("store.listProjects", { message: "connection failed" }),
    (err) => err instanceof ApiError && err.code === "database_error"
  );
});

test("runQuery returns data when the query succeeds", async () => {
  const data = await runQuery(
    "store.getProject",
    fakeQuery({ data: { id: "p_1" }, error: null }),
    { logger: silentLogger }
  );
  assert.deepEqual(data, { id: "p_1" });
});

test("runQuery throws a database_error when the query errors", async () => {
  await assert.rejects(
    runQuery("store.getProject", fakeQuery({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }), {
      logger: silentLogger,
    }),
    (err) =>
      err instanceof ApiError &&
      err.code === "database_error" &&
      err.details?.operation === "store.getProject" &&
      err.details?.dbCode === "57014"
  );
});

test("runQuery surfaces a missing row as an error by default", async () => {
  await assert.rejects(
    runQuery("store.getProject", fakeQuery({ data: null, error: { code: "PGRST116" } }), {
      logger: silentLogger,
    }),
    (err) => err instanceof ApiError && err.code === "database_error"
  );
});

test("runQuery returns null for a missing row when allowMissing is set", async () => {
  const data = await runQuery(
    "store.getProject",
    fakeQuery({ data: null, error: { code: "PGRST116" } }),
    { allowMissing: true, logger: silentLogger }
  );
  assert.equal(data, null);
});

test("runQuery still throws non-missing errors even with allowMissing", async () => {
  await assert.rejects(
    runQuery(
      "store.getProject",
      fakeQuery({ data: null, error: { code: "42P01", message: "relation does not exist" } }),
      { allowMissing: true, logger: silentLogger }
    ),
    (err) => err instanceof ApiError && err.code === "database_error"
  );
});
