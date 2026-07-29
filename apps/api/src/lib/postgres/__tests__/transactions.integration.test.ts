import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { withTransaction, closePostgresPool } from "../transactions.js";

const runLocalIntegration =
  process.env.RUN_LOCAL_DB_INTEGRATION === "1" &&
  /127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? "");
const integrationTest = runLocalIntegration ? test : test.skip;

integrationTest("a failed direct transaction observably rolls back local DDL", async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const table = `transaction_rollback_${suffix}`;
  const escapedTable = `"${table}"`;
  const observer = new Pool({ connectionString: process.env.DATABASE_URL });
  const original = new Error("force rollback");

  try {
    await assert.rejects(
      withTransaction("test.observableRollback", async (client) => {
        await client.query(`CREATE TABLE ${escapedTable} (id integer PRIMARY KEY)`);
        throw original;
      }),
      (error: unknown) => error === original
    );
    const result = await observer.query<{ relation: string | null }>(
      "select to_regclass($1) as relation",
      [`public.${table}`]
    );
    assert.equal(result.rows[0]?.relation, null);
  } finally {
    await observer.query(`DROP TABLE IF EXISTS ${escapedTable}`);
    await observer.end();
    await closePostgresPool();
  }
});
