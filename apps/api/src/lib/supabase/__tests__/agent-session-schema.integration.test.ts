import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// PR 4 acceptance (docs/scopes/specialist-agent-orchestration-prs.md): one
// Visuals session per project, collision-free concurrent sequence allocation,
// active ownership, immutable identity, one trusted origin, valid
// parent/continuation links, one immutable terminal report action, general
// action/job/asset attribution, public denial of raw control data, and
// cross-project/cross-workspace rejection — without a synthetic root or
// duplicate domain tables.
const localUrl = process.env.SUPABASE_URL ?? "";
const runLocalIntegration =
  process.env.RUN_LOCAL_DB_INTEGRATION === "1" &&
  /127\.0\.0\.1|localhost/.test(localUrl) &&
  Boolean(process.env.SUPABASE_ANON_KEY) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

const integrationTest = runLocalIntegration ? test : test.skip;

function client(key: string): SupabaseClient {
  return createClient(localUrl, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function assertNoError(error: { message: string } | null, operation: string): void {
  assert.equal(error, null, `${operation}: ${error?.message ?? "unknown error"}`);
}

interface AllocatedSequence {
  session_id: string;
  allocated_sequence: number;
  claim_generation: number;
}

integrationTest(
  "agent sessions allocate collision-free sequences and enforce the finite-run invariants",
  async () => {
    const service = client(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const anon = client(process.env.SUPABASE_ANON_KEY!);
    const suffix = randomUUID();
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const projectId = randomUUID();
    const otherProjectId = randomUUID();
    const rootRunId = randomUUID();
    const domainRunId = randomUUID();
    const delegationActionId = randomUUID();
    const reportActionId = randomUUID();
    const assetId = randomUUID();

    try {
      const { error: workspaceError } = await service.from("workspaces").insert([
        { id: workspaceId, name: `__agent_session_test__${suffix}` },
        { id: otherWorkspaceId, name: `__agent_session_other__${suffix}` },
      ]);
      assertNoError(workspaceError, "create workspaces");

      const { error: projectError } = await service.from("projects").insert([
        {
          id: projectId,
          workspace_id: workspaceId,
          name: `Agent session test ${suffix}`,
          visibility: "public",
        },
        {
          id: otherProjectId,
          workspace_id: otherWorkspaceId,
          name: `Agent session other ${suffix}`,
          visibility: "private",
        },
      ]);
      assertNoError(projectError, "create projects");

      // --- create/reuse one Visuals session; concurrent allocation is
      // collision-free and never computed from max(sequence) + 1.
      const concurrent = await Promise.all(
        Array.from({ length: 12 }, () =>
          service.rpc("allocate_agent_session_sequence", {
            p_project_id: projectId,
            p_domain: "visuals",
          })
        )
      );
      const allocations: AllocatedSequence[] = concurrent.map((result, index) => {
        assertNoError(result.error, `allocate sequence #${index}`);
        const row = (result.data as AllocatedSequence[])[0];
        assert.ok(row, `allocation #${index} returned a row`);
        return row;
      });
      const sessionIds = new Set(allocations.map((row) => row.session_id));
      assert.equal(sessionIds.size, 1, "every allocation reuses the one Visuals session");
      const sequences = allocations.map((row) => row.allocated_sequence).sort((a, b) => a - b);
      assert.deepEqual(
        sequences,
        Array.from({ length: 12 }, (_, index) => index + 1),
        "concurrent allocations produce a dense, collision-free sequence"
      );
      const sessionId = allocations[0].session_id;

      const { count: sessionCount } = await service
        .from("agent_sessions")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("domain", "visuals");
      assert.equal(sessionCount, 1, "exactly one (project, visuals) session row");

      // The allocator is service-only.
      const { error: anonAllocError } = await anon.rpc("allocate_agent_session_sequence", {
        p_project_id: projectId,
        p_domain: "visuals",
      });
      assert.ok(anonAllocError, "anon must not allocate session sequences");

      // --- trusted root origin: root run + delegation action + domain run.
      const { error: rootError } = await service.from("orchestrator_runs").insert({
        id: rootRunId,
        project_id: projectId,
        status: "running",
        input_summary: "root run",
      });
      assertNoError(rootError, "create root run");
      const { error: delegationError } = await service.from("actions").insert({
        id: delegationActionId,
        project_id: projectId,
        orchestrator_run_id: rootRunId,
        tool: "delegate_visuals",
        status: "running",
      });
      assertNoError(delegationError, "create delegation action");

      const taskParams = {
        schema_version: "DomainTask.v1",
        domain: "visuals",
        taskKind: "visuals_production",
      };
      const { error: domainRunError } = await service.from("orchestrator_runs").insert({
        id: domainRunId,
        project_id: projectId,
        status: "queued",
        input_summary: "visuals assignment",
        agent_role: "visuals",
        agent_session_id: sessionId,
        session_sequence: 1,
        task_kind: "visuals_production",
        task_params: taskParams,
        origin_kind: "creative_director",
        parent_run_id: rootRunId,
        root_action_id: delegationActionId,
      });
      assertNoError(domainRunError, "create domain run");

      const { data: domainRun } = await service
        .from("orchestrator_runs")
        .select("completion_recipient")
        .eq("id", domainRunId)
        .single();
      assert.equal(
        domainRun?.completion_recipient,
        "creative_director",
        "the completion recipient derives from the trusted origin"
      );

      // Dual origins are unrepresentable.
      const { error: dualOriginError } = await service.from("orchestrator_runs").insert({
        project_id: projectId,
        status: "queued",
        input_summary: "dual origin",
        agent_role: "visuals",
        agent_session_id: sessionId,
        session_sequence: 2,
        task_kind: "visuals_revision",
        task_params: { ...taskParams, taskKind: "visuals_revision" },
        origin_kind: "creative_director",
        parent_run_id: rootRunId,
        root_action_id: delegationActionId,
        origin_actor_id: randomUUID(),
        origin_request: { schema_version: "CreatorDirectOrigin.v1" },
      });
      assert.ok(dualOriginError, "a run with both origins must be rejected");

      // Cross-project session links are rejected.
      const { error: crossProjectError } = await service.from("orchestrator_runs").insert({
        project_id: otherProjectId,
        status: "queued",
        input_summary: "cross project",
        agent_role: "visuals",
        agent_session_id: sessionId,
        session_sequence: 3,
        task_kind: "visuals_revision",
        task_params: { ...taskParams, taskKind: "visuals_revision" },
        origin_kind: "creative_director",
        parent_run_id: rootRunId,
        root_action_id: delegationActionId,
      });
      assert.ok(crossProjectError, "a run may not join a session in another project");

      // Assignment identity is immutable.
      const { error: identityError } = await service
        .from("orchestrator_runs")
        .update({ task_kind: "visuals_revision" })
        .eq("id", domainRunId);
      assert.ok(identityError, "task_kind must be immutable once assigned");

      // --- active ownership: the session slot only accepts its own run.
      const { error: claimError } = await service
        .from("agent_sessions")
        .update({ active_run_id: domainRunId, claim_generation: 1 })
        .eq("id", sessionId);
      assertNoError(claimError, "claim active ownership");
      const { error: foreignClaimError } = await service
        .from("agent_sessions")
        .update({ active_run_id: rootRunId })
        .eq("id", sessionId);
      assert.ok(foreignClaimError, "a run outside the session cannot hold the active slot");
      const { error: claimRollbackError } = await service
        .from("agent_sessions")
        .update({ claim_generation: 0 })
        .eq("id", sessionId);
      assert.ok(claimRollbackError, "the durable claim generation is monotonic");

      // --- one immutable terminal report action per finite domain run.
      const { error: reportError } = await service.from("actions").insert({
        id: reportActionId,
        project_id: projectId,
        orchestrator_run_id: domainRunId,
        tool: "domain_report",
        status: "applied",
        params: {
          schema_version: "DomainReport.v1",
          outcome: { outcome: "done" },
        },
      });
      assertNoError(reportError, "create domain report action");
      const { error: duplicateReportError } = await service.from("actions").insert({
        project_id: projectId,
        orchestrator_run_id: domainRunId,
        tool: "domain_report",
        status: "applied",
        params: {
          schema_version: "DomainReport.v1",
          outcome: { outcome: "done" },
        },
      });
      assert.ok(duplicateReportError, "a finite run accepts exactly one report action");
      const { error: rootReportError } = await service.from("actions").insert({
        project_id: projectId,
        orchestrator_run_id: rootRunId,
        tool: "domain_report",
        status: "applied",
        params: {
          schema_version: "DomainReport.v1",
          outcome: { outcome: "done" },
        },
      });
      assert.ok(rootReportError, "a report is only valid on a domain-role run");
      const { error: reportMutationError } = await service
        .from("actions")
        .update({ output_asset_ids: [randomUUID()] })
        .eq("id", reportActionId);
      assert.ok(reportMutationError, "report output links are immutable once inserted");

      // --- general action/job/asset attribution stays same-project.
      const { error: assetError } = await service.from("assets").insert({
        id: assetId,
        workspace_id: workspaceId,
        project_id: projectId,
        kind: "brief",
        media: "data",
        content: { schema_version: "brief.v1", summary: "attribution test" },
        filename: "attribution.json",
        source: {},
      });
      assertNoError(assetError, "create asset");
      const { error: attributionError } = await service.from("action_assets").insert({
        project_id: projectId,
        action_id: reportActionId,
        asset_id: assetId,
        direction: "output",
        role: "primary",
        ordinal: 0,
      });
      assertNoError(attributionError, "create action_assets row");
      const { error: crossAttributionError } = await service.from("action_assets").insert({
        project_id: otherProjectId,
        action_id: reportActionId,
        asset_id: assetId,
        direction: "output",
        ordinal: 1,
      });
      assert.ok(crossAttributionError, "action_assets rejects cross-project attribution");
      const { error: jobError } = await service.from("jobs").insert({
        workspace_id: workspaceId,
        project_id: projectId,
        type: "asset_generation",
        action_id: delegationActionId,
        session_claim_generation: 1,
      });
      assertNoError(jobError, "create job with canonical action attribution");
      const { error: crossJobError } = await service.from("jobs").insert({
        workspace_id: otherWorkspaceId,
        project_id: otherProjectId,
        type: "asset_generation",
        action_id: delegationActionId,
      });
      assert.ok(crossJobError, "jobs reject cross-project action attribution");

      // --- terminal continuation in the same session, one-use.
      const { error: terminalizeError } = await service
        .from("orchestrator_runs")
        .update({ status: "succeeded", completed_at: new Date().toISOString() })
        .eq("id", domainRunId);
      assertNoError(terminalizeError, "terminalize the domain run");
      const successorBase = {
        project_id: projectId,
        status: "queued",
        input_summary: "successor",
        agent_role: "visuals",
        agent_session_id: sessionId,
        task_kind: "visuals_revision",
        task_params: { ...taskParams, taskKind: "visuals_revision" },
        origin_kind: "creative_director",
        parent_run_id: rootRunId,
        root_action_id: delegationActionId,
        continues_run_id: domainRunId,
      };
      const { error: successorError } = await service
        .from("orchestrator_runs")
        .insert({ ...successorBase, session_sequence: 2 });
      assertNoError(successorError, "create the continuation successor");
      const { error: secondSuccessorError } = await service
        .from("orchestrator_runs")
        .insert({ ...successorBase, session_sequence: 3 });
      assert.ok(secondSuccessorError, "a question/blocked answer is one-use");

      // --- cross-workspace dispatch rejection.
      const { error: dispatchMismatchError } = await service
        .from("orchestrator_dispatches")
        .insert({ orchestrator_run_id: rootRunId, workspace_id: otherWorkspaceId });
      assert.ok(dispatchMismatchError, "dispatch workspace must match the run's workspace");

      // --- public denial of raw control data (the project is public).
      for (const table of ["agent_sessions", "orchestrator_runs", "actions", "action_assets", "jobs"]) {
        const { data: anonRows, error: anonReadError } = await anon
          .from(table)
          .select("id")
          .eq("project_id", projectId);
        assertNoError(anonReadError, `anon select ${table}`);
        assert.equal(
          (anonRows ?? []).length,
          0,
          `anon must not read raw ${table} rows even for public projects`
        );
      }
      // The sanitized projection remains available and never leaks control data.
      const { data: progress, error: progressError } = await anon.rpc(
        "public_orchestrator_run_progress",
        { p_project_id: projectId }
      );
      assertNoError(progressError, "anon sanitized progress projection");
      const progressRows = (progress ?? []) as Array<Record<string, unknown>>;
      assert.ok(progressRows.length >= 1, "public projects expose sanitized run progress");
      for (const row of progressRows) {
        assert.deepEqual(
          Object.keys(row).sort(),
          [
            "agent_role",
            "completed_at",
            "created_at",
            "id",
            "project_id",
            "started_at",
            "status",
            "updated_at",
          ],
          "the projection exposes progress fields only"
        );
      }

      // Sessions are never deleted by clients.
      const { data: deletedSessions, error: anonDeleteError } = await anon
        .from("agent_sessions")
        .delete()
        .eq("id", sessionId)
        .select("id");
      assertNoError(anonDeleteError, "anon delete is silently denied by RLS");
      assert.equal((deletedSessions ?? []).length, 0, "anon cannot delete sessions");
    } finally {
      await service.from("projects").delete().in("id", [projectId, otherProjectId]);
      await service.from("workspaces").delete().in("id", [workspaceId, otherWorkspaceId]);
    }
  }
);
