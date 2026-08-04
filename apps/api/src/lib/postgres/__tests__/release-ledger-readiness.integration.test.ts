import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { createReleaseReadiness } from "../../release-readiness.js";
import type { TransactionRunner } from "../creator-direct-confirmation.js";
import { createTransactionRunner } from "../transactions.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
const runLocalIntegration =
  process.env.RUN_LOCAL_DB_INTEGRATION === "1" &&
  /127\.0\.0\.1|localhost/.test(databaseUrl);
const integrationTest = runLocalIntegration ? test : test.skip;
const gitSha = "1".repeat(40);

function migrationSetSha256(versions: string[]) {
  return createHash("sha256")
    .update(`sha256-migration-set-v1\n${versions.join("\n")}\n`)
    .digest("hex");
}

function asApiRoleRunner(pool: Pool): TransactionRunner {
  const run = createTransactionRunner(pool);
  return (operation, callback) =>
    run(operation, async (client) => {
      await client.query("set local role popcorn_api");
      return callback(client);
    });
}

integrationTest(
  "popcorn_api can prove release readiness without broader migration-ledger access",
  async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 2 });
    try {
      await pool.query("grant popcorn_api to postgres");
      const applied = await pool.query<{ version: string }>(
        `select version
           from supabase_migrations.schema_migrations
          order by version`,
      );
      const versions = applied.rows.map((row) => row.version);
      assert.ok(versions.includes("20260804154000"));

      const columns = await pool.query<{ column_name: string }>(
        `select column_name
           from information_schema.columns
          where table_schema = 'supabase_migrations'
            and table_name = 'schema_migrations'
          order by ordinal_position`,
      );
      assert.ok(columns.rows.length > 1);

      const privilege = await pool.query<{
        table_select: boolean;
        version_select: boolean;
      }>(
        `select
           has_table_privilege(
             'popcorn_api',
             'supabase_migrations.schema_migrations',
             'select'
           ) as table_select,
           has_column_privilege(
             'popcorn_api',
             'supabase_migrations.schema_migrations',
             'version',
             'select'
           ) as version_select`,
      );
      assert.equal(privilege.rows[0]?.table_select, false);
      assert.equal(privilege.rows[0]?.version_select, true);

      for (const { column_name: columnName } of columns.rows) {
        if (columnName === "version") continue;
        const result = await pool.query<{ allowed: boolean }>(
          `select has_column_privilege(
             'popcorn_api',
             'supabase_migrations.schema_migrations',
             $1,
             'select'
           ) as allowed`,
          [columnName],
        );
        assert.equal(result.rows[0]?.allowed, false, columnName);
      }

      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("set local role popcorn_api");
        const allowed = await client.query(
          "select version from supabase_migrations.schema_migrations limit 1",
        );
        assert.equal(allowed.rowCount, 1);
        await client.query("savepoint denied_read");
        await assert.rejects(
          client.query("select * from supabase_migrations.schema_migrations limit 1"),
          (error: unknown) =>
            error instanceof Error &&
            "code" in error &&
            (error as { code?: string }).code === "42501",
        );
        await client.query("rollback to savepoint denied_read");
        await client.query("rollback");
      } finally {
        client.release();
      }

      const readiness = createReleaseReadiness({
        runTransaction: asApiRoleRunner(pool),
        env: {
          NODE_ENV: "production",
          DATABASE_URL: databaseUrl,
          RAILWAY_GIT_COMMIT_SHA: gitSha,
        },
        loadManifest: async () => ({
          schemaVersion: 1,
          surface: "api",
          artifactHashAlgorithm: "sha256-manifest-v1",
          releaseOrchestrationId: gitSha,
          gitSha,
          apiArtifactSha256: "2".repeat(64),
          builtAt: "2026-08-04T00:00:00.000Z",
          environment: "production",
          requiredMigrationCount: versions.length,
          requiredMigrationSetSha256: migrationSetSha256(versions),
          requiredMigrationVersions: versions,
        }),
      });
      const result = await readiness();
      assert.equal(result.ready, true);
      assert.equal(result.databaseCompatible, true);
      assert.equal(result.appliedRequiredMigrationCount, versions.length);
    } finally {
      await pool.query("revoke popcorn_api from postgres").catch(() => undefined);
      await pool.end();
    }
  },
);
