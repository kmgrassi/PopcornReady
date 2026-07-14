import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

integrationTest(
  "dispatch RPCs enforce roles, preserve a claimed wake, and reject workspace drift",
  async () => {
    const service = client(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const anon = client(process.env.SUPABASE_ANON_KEY!);
    const suffix = randomUUID();
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const projectId = randomUUID();
    const runId = randomUUID();
    let authUserId: string | undefined;

    try {
      const { error: workspaceError } = await service.from("workspaces").insert([
        { id: workspaceId, name: `__dispatch_test__${suffix}` },
        { id: otherWorkspaceId, name: `__dispatch_other__${suffix}` },
      ]);
      assertNoError(workspaceError, "create workspaces");

      const { error: projectError } = await service.from("projects").insert({
        id: projectId,
        workspace_id: workspaceId,
        name: `Dispatch test ${suffix}`,
        visibility: "private",
      });
      assertNoError(projectError, "create project");

      const { error: runError } = await service.from("orchestrator_runs").insert({
        id: runId,
        project_id: projectId,
        status: "waiting",
        input_summary: "Local dispatch integration test",
      });
      assertNoError(runError, "create run");

      const { error: anonWakeError } = await anon.rpc("wake_orchestrator_dispatch", {
        p_orchestrator_run_id: runId,
      });
      assert.ok(anonWakeError, "anon must not execute the wake RPC");
      assert.equal(anonWakeError.code, "42501");

      const email = `dispatch-${suffix}@example.test`;
      const password = `D!${suffix}x`;
      const { data: createdUser, error: createUserError } = await service.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      assertNoError(createUserError, "create authenticated test user");
      authUserId = createdUser.user?.id;
      assert.ok(authUserId);

      const authBase = client(process.env.SUPABASE_ANON_KEY!);
      const { data: signedIn, error: signInError } = await authBase.auth.signInWithPassword({
        email,
        password,
      });
      assertNoError(signInError, "sign in authenticated test user");
      assert.ok(signedIn.session?.access_token);
      const authenticated = createClient(localUrl, process.env.SUPABASE_ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
        global: {
          headers: { Authorization: `Bearer ${signedIn.session.access_token}` },
        },
      });
      const { error: authenticatedWakeError } = await authenticated.rpc(
        "wake_orchestrator_dispatch",
        { p_orchestrator_run_id: runId }
      );
      assert.ok(authenticatedWakeError, "authenticated users must not execute the wake RPC");
      assert.equal(authenticatedWakeError.code, "42501");

      const { error: wakeError } = await service.rpc("wake_orchestrator_dispatch", {
        p_orchestrator_run_id: runId,
      });
      assertNoError(wakeError, "service wake");

      const { data: queued, error: queuedError } = await service
        .from("orchestrator_dispatches")
        .select("id,workspace_id,status,lease_token,pending_wake_at")
        .eq("orchestrator_run_id", runId)
        .single();
      assertNoError(queuedError, "read queued dispatch");
      assert.ok(queued);
      assert.equal(queued.workspace_id, workspaceId);
      assert.equal(queued.status, "queued");
      assert.equal(queued.lease_token, null);
      assert.equal(queued.pending_wake_at, null);

      const { data: claims, error: claimError } = await service.rpc(
        "claim_orchestrator_dispatches",
        { p_limit: 1, p_lease_seconds: 120 }
      );
      assertNoError(claimError, "claim dispatch");
      const claim = (claims as Array<{
        dispatch_id: string;
        orchestrator_run_id: string;
        workspace_id: string;
        lease_token: string;
      }>).find((row) => row.orchestrator_run_id === runId);
      assert.ok(claim, "the test dispatch should be claimed");
      assert.equal(claim.workspace_id, workspaceId);

      const { error: claimedWakeError } = await service.rpc("wake_orchestrator_dispatch", {
        p_orchestrator_run_id: runId,
      });
      assertNoError(claimedWakeError, "wake claimed dispatch");

      const { data: claimed, error: claimedError } = await service
        .from("orchestrator_dispatches")
        .select("status,lease_token,pending_wake_at")
        .eq("id", claim.dispatch_id)
        .single();
      assertNoError(claimedError, "read claimed dispatch");
      assert.ok(claimed);
      assert.equal(claimed.status, "claimed");
      assert.equal(claimed.lease_token, claim.lease_token);
      assert.ok(claimed.pending_wake_at, "a wake racing the lease must be retained");

      const { data: released, error: releaseError } = await service.rpc(
        "release_orchestrator_dispatch",
        {
          p_dispatch_id: claim.dispatch_id,
          p_lease_token: claim.lease_token,
          p_delay_seconds: 30,
          p_completed: true,
        }
      );
      assertNoError(releaseError, "release claimed dispatch");
      assert.equal(released, true);

      const { data: requeued, error: requeuedError } = await service
        .from("orchestrator_dispatches")
        .select("status,lease_token,pending_wake_at")
        .eq("id", claim.dispatch_id)
        .single();
      assertNoError(requeuedError, "read requeued dispatch");
      assert.ok(requeued);
      assert.equal(requeued.status, "queued");
      assert.equal(requeued.lease_token, null);
      assert.equal(requeued.pending_wake_at, null);

      const { error: driftError } = await service
        .from("orchestrator_dispatches")
        .update({ workspace_id: otherWorkspaceId })
        .eq("id", claim.dispatch_id);
      assertNoError(driftError, "create workspace-drift fixture");

      const { error: driftWakeError } = await service.rpc("wake_orchestrator_dispatch", {
        p_orchestrator_run_id: runId,
      });
      assert.ok(driftWakeError, "workspace drift must be rejected");
      assert.equal(driftWakeError.code, "23514");

      const { data: drifted, error: driftedError } = await service
        .from("orchestrator_dispatches")
        .select("workspace_id,status")
        .eq("id", claim.dispatch_id)
        .single();
      assertNoError(driftedError, "read rejected drift fixture");
      assert.ok(drifted);
      assert.equal(drifted.workspace_id, otherWorkspaceId);
      assert.equal(drifted.status, "queued");
    } finally {
      if (authUserId) await service.auth.admin.deleteUser(authUserId);
      await service.from("workspaces").delete().in("id", [workspaceId, otherWorkspaceId]);
    }
  }
);
