import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

const localUrl = process.env.SUPABASE_URL ?? "";
const runLocalIntegration =
  process.env.RUN_LOCAL_DB_INTEGRATION === "1" &&
  /127\.0\.0\.1|localhost/.test(localUrl) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
const integrationTest = runLocalIntegration ? test : test.skip;

integrationTest(
  "retired profile schema keeps superseded roots irreversible and anonymous admission live",
  async () => {
    const service = createClient(
      localUrl,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      }
    );
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const runId = randomUUID();
    const now = new Date().toISOString();
    try {
      const workspace = await service.from("workspaces").insert({
        id: workspaceId,
        name: `__pr7b_retirement_${randomUUID()}`,
      });
      assert.equal(workspace.error, null, workspace.error?.message);
      const project = await service.from("projects").insert({
        id: projectId,
        workspace_id: workspaceId,
        name: "PR7B retirement integration",
        visibility: "private",
      });
      assert.equal(project.error, null, project.error?.message);
      const run = await service.from("orchestrator_runs").insert({
        id: runId,
        project_id: projectId,
        status: "superseded",
        superseded_at: now,
        completed_at: now,
        input_summary: "Structurally retired root",
        agent_role: "creative_director",
      });
      assert.equal(run.error, null, run.error?.message);

      const reopen = await service
        .from("orchestrator_runs")
        .update({
          status: "running",
          superseded_at: null,
          completed_at: null,
        })
        .eq("id", runId);
      assert.match(
        reopen.error?.message ?? "",
        /orchestrator run assignment identity is immutable/
      );

      const retiredColumn = await service
        .from("orchestrator_runs")
        .select("root_execution_profile")
        .eq("id", runId);
      assert.ok(retiredColumn.error, "retired profile column unexpectedly remained queryable");

      const anonymous = await service.rpc(
        "create_orchestrator_run_with_anonymous_quota",
        {
          p_project_id: projectId,
          p_input_summary: "Anonymous admission after PR7B",
          p_budget_usd: 1,
          p_window_start: "2000-01-01T00:00:00.000Z",
          p_limit: 100,
          p_deploy_id: null,
          p_git_sha: null,
        }
      );
      assert.equal(anonymous.error, null, anonymous.error?.message);
      assert.equal(anonymous.data?.[0]?.quota_exceeded, false);
      assert.match(anonymous.data?.[0]?.run_id ?? "", /^[0-9a-f-]{36}$/);
    } finally {
      const cleanup = await service
        .from("workspaces")
        .delete()
        .eq("id", workspaceId);
      assert.equal(cleanup.error, null, cleanup.error?.message);
    }
  }
);
