import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";
import { Pool, type PoolClient } from "pg";
import { createAction } from "@/lib/api/v1/store";
import { dispatchDomainRun } from "@/lib/orchestrator/domain-run-service";
import {
  createConfirmCreatorDirectProposal,
  type ConfirmCreatorDirectProposalInput,
  type TransactionRunner,
} from "../creator-direct-confirmation.js";
import { createCreatorDirectDatabaseReadiness } from "../creator-direct-readiness.js";
import { createTransactionRunner } from "../transactions.js";

const localUrl = process.env.SUPABASE_URL ?? "";
const databaseUrl = process.env.DATABASE_URL ?? "";
const runLocalIntegration =
  process.env.RUN_LOCAL_DB_INTEGRATION === "1" &&
  /127\.0\.0\.1|localhost/.test(localUrl) &&
  /127\.0\.0\.1|localhost/.test(databaseUrl) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
const integrationTest = runLocalIntegration ? test : test.skip;

function serviceClient(): SupabaseClient {
  return createClient(localUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

interface Proposal {
  input: ConfirmCreatorDirectProposalInput;
  runId: string;
}

function task(projectId: string, actorId: string, requestDigest: string): DomainTaskV1 {
  return {
    schemaVersion: "DomainTask.v1",
    domain: "visuals",
    taskKind: "image_create",
    objective: "Create an integration-test image",
    instruction: "Create an integration-test image",
    targets: [{ kind: "project", projectId }],
    requiredOutputs: [{ kind: "image", role: "creator_direct", minimumCount: 1 }],
    allowedOutputKinds: ["image"],
    creativeConstraints: {},
    preserve: { assetIds: [], selections: [], fingerprints: [], pins: [] },
    candidateAffectedAssetIds: [],
    budgetUsd: 10,
    approvalContext: {
      proposalActionId: randomUUID() as never,
      approvedBudgetUsd: 10,
      approvalFingerprint: requestDigest,
    },
    acceptanceCriteria: ["One image exists"],
    origin: {
      kind: "creator_direct",
      actorId,
      creatorMessageId: requestDigest,
      entrypoint: "project_api",
      requestDigest,
      idempotencyKey: randomUUID(),
      approvalGateId: randomUUID(),
    },
    responseRecipient: { kind: "creator_conversation" },
  };
}

async function createProposal(
  service: SupabaseClient,
  workspaceId: string,
  projectId: string,
  actorId: string,
  label: string
): Promise<Proposal> {
  const requestDigest = createHash("sha256").update(label).digest("hex");
  const approvalToken = `creator-direct-${randomUUID()}`;
  const gateId = randomUUID();
  const proposalActionId = randomUUID();
  const dispatch = await dispatchDomainRun({
    projectId,
    domain: "visuals",
    task: task(projectId, actorId, requestDigest),
    inputSummary: label,
    budgetUsd: 10,
    origin: {
      kind: "creator_direct",
      actorId,
      request: { requestDigest },
    },
    enqueue: false,
    idempotencyKey: `integration-${label}-${randomUUID()}`,
  });
  await createAction({
    id: proposalActionId,
    projectId,
    orchestratorRunId: dispatch.runId,
    tool: "creator_direct_proposal",
    status: "proposed",
    params: { kind: "image_create", requestDigest, maximumUsd: 10 },
    rationale: label,
    proposal: { maximumUsd: 10 },
  });
  const { error } = await service.rpc(
    "create_creator_direct_proposal_gate_with_id",
    {
      p_gate_id: gateId,
      p_project_id: projectId,
      p_run_id: dispatch.runId,
      p_proposal_action_id: proposalActionId,
      p_actor_id: actorId,
      p_request_digest: requestDigest,
      p_approved_max_usd: 10,
      p_approval_token_hash: createHash("sha256")
        .update(approvalToken)
        .digest("hex"),
      p_expires_at: new Date(Date.now() + 60_000).toISOString(),
    }
  );
  assert.equal(error, null, `create gate: ${error?.message ?? "unknown"}`);
  return {
    runId: dispatch.runId,
    input: {
      workspaceId,
      projectId,
      actorId,
      gateId,
      requestDigest,
      approvedMaxUsd: 10,
      approvalToken,
      idempotencyKey: `confirm-${randomUUID()}`,
    },
  };
}

function asRoleRunner(pool: Pool): TransactionRunner {
  const run = createTransactionRunner(pool);
  return (operation, callback) =>
    run(operation, async (client) => {
      await client.query("set local role popcorn_api");
      const identity = await client.query<{ role: string }>(
        "select current_user as role"
      );
      assert.equal(identity.rows[0]?.role, "popcorn_api");
      return callback(client);
    });
}

function hasDatabaseMessage(expected: string) {
  return (error: unknown): boolean =>
    error instanceof Error &&
    "details" in error &&
    (error as { details?: { dbMessage?: string } }).details?.dbMessage ===
      expected;
}

integrationTest(
  "popcorn_api confirmation matches legacy state, enforces scope, serializes replay, and rolls back late failure",
  async () => {
    const service = serviceClient();
    const pool = new Pool({ connectionString: databaseUrl, max: 4 });
    const roleRunner = asRoleRunner(pool);
    const confirm = createConfirmCreatorDirectProposal(roleRunner);
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const projectId = randomUUID();
    const actorId = randomUUID();
    const suffix = randomUUID();

    try {
      // The local Supabase postgres role can create roles but is not a
      // superuser, so SET ROLE requires explicit membership for this test
      // harness. Production connects as popcorn_api directly.
      await pool.query("grant popcorn_api to postgres");
      await pool.query("grant delete on public.projects to popcorn_api");
      assert.deepEqual(
        await createCreatorDirectDatabaseReadiness(roleRunner, {
          NODE_ENV: "production",
          DATABASE_URL: databaseUrl,
        })(),
        { ready: false, checked: true }
      );
      await pool.query("revoke delete on public.projects from popcorn_api");
      await pool.query("drop role if exists popcorn_api_readiness_probe");
      await pool.query("create role popcorn_api_readiness_probe nologin");
      await pool.query("grant popcorn_api_readiness_probe to popcorn_api");
      assert.deepEqual(
        await createCreatorDirectDatabaseReadiness(roleRunner, {
          NODE_ENV: "production",
          DATABASE_URL: databaseUrl,
        })(),
        { ready: false, checked: true }
      );
      await pool.query("revoke popcorn_api_readiness_probe from popcorn_api");
      await pool.query("drop role popcorn_api_readiness_probe");
      assert.deepEqual(
        await createCreatorDirectDatabaseReadiness(roleRunner, {
          NODE_ENV: "production",
          DATABASE_URL: databaseUrl,
        })(),
        { ready: true, checked: true }
      );
      let response = await service.from("users").insert({
        id: actorId,
        email: `creator-confirm-${suffix}@example.test`,
      });
      assert.equal(response.error, null, response.error?.message);
      response = await service.from("workspaces").insert([
        { id: workspaceId, name: `Creator confirm ${suffix}` },
        { id: otherWorkspaceId, name: `Creator confirm other ${suffix}` },
      ]);
      assert.equal(response.error, null, response.error?.message);
      response = await service.from("projects").insert({
        id: projectId,
        workspace_id: workspaceId,
        name: `Creator confirm ${suffix}`,
        visibility: "private",
      });
      assert.equal(response.error, null, response.error?.message);

      const scoped = await createProposal(
        service,
        workspaceId,
        projectId,
        actorId,
        "scope"
      );
      await assert.rejects(
        confirm({ ...scoped.input, workspaceId: otherWorkspaceId }),
        hasDatabaseMessage("creator_direct_confirmation_invalid")
      );
      await assert.rejects(
        confirm({ ...scoped.input, actorId: randomUUID() }),
        hasDatabaseMessage("creator_direct_confirmation_invalid")
      );

      const expired = await createProposal(
        service,
        workspaceId,
        projectId,
        actorId,
        "expired"
      );
      const { error: expireError } = await service
        .from("orchestrator_run_gates")
        .update({ expires_at: new Date(Date.now() - 1_000).toISOString() })
        .eq("id", expired.input.gateId);
      assert.equal(expireError, null, expireError?.message);
      await assert.rejects(
        confirm(expired.input),
        hasDatabaseMessage("creator_direct_confirmation_invalid")
      );

      const canceled = await createProposal(
        service,
        workspaceId,
        projectId,
        actorId,
        "canceled"
      );
      const { error: cancelError } = await service
        .from("orchestrator_runs")
        .update({ status: "canceled", completed_at: new Date().toISOString() })
        .eq("id", canceled.runId);
      assert.equal(cancelError, null, cancelError?.message);
      await assert.rejects(
        confirm(canceled.input),
        hasDatabaseMessage("creator_direct_gate_run_not_queued")
      );

      const concurrent = await createProposal(
        service,
        workspaceId,
        projectId,
        actorId,
        "concurrent"
      );
      const confirmations = await Promise.all([
        confirm(concurrent.input),
        confirm(concurrent.input),
      ]);
      assert.deepEqual(
        confirmations.map((entry) => entry.consumed).sort(),
        [false, true]
      );
      assert.ok(confirmations.every((entry) => entry.runId === concurrent.runId));

      const { data: directGate } = await service
        .from("orchestrator_run_gates")
        .select("status,token_consumed_at")
        .eq("id", concurrent.input.gateId)
        .single();
      assert.equal(directGate?.status, "approved");
      assert.ok(directGate?.token_consumed_at);
      const { count: directReservations } = await service
        .from("orchestrator_budget_reservations")
        .select("id", { count: "exact", head: true })
        .eq("orchestrator_run_id", concurrent.runId);
      const { count: directDispatches } = await service
        .from("orchestrator_dispatches")
        .select("id", { count: "exact", head: true })
        .eq("orchestrator_run_id", concurrent.runId);
      assert.equal(directReservations, 1);
      assert.equal(directDispatches, 1);

      const competing = await createProposal(
        service,
        workspaceId,
        projectId,
        actorId,
        "competing-keys"
      );
      const competingConfirmations = await Promise.allSettled([
        confirm(competing.input),
        confirm({
          ...competing.input,
          idempotencyKey: `confirm-${randomUUID()}`,
        }),
      ]);
      const competingSuccesses = competingConfirmations.filter(
        (entry) => entry.status === "fulfilled"
      );
      const competingFailures = competingConfirmations.filter(
        (entry) => entry.status === "rejected"
      );
      assert.equal(competingSuccesses.length, 1);
      assert.equal(competingFailures.length, 1);
      assert.equal(
        competingSuccesses[0]?.status === "fulfilled"
          ? competingSuccesses[0].value.consumed
          : null,
        true
      );
      assert.ok(
        competingFailures[0]?.status === "rejected" &&
          (hasDatabaseMessage("creator_direct_confirmation_invalid")(
            competingFailures[0].reason
          ) ||
            hasDatabaseMessage(
              "creator_direct_confirmation_already_consumed"
            )(competingFailures[0].reason))
      );
      const { count: competingReservations } = await service
        .from("orchestrator_budget_reservations")
        .select("id", { count: "exact", head: true })
        .eq("orchestrator_run_id", competing.runId);
      const { count: competingDispatches } = await service
        .from("orchestrator_dispatches")
        .select("id", { count: "exact", head: true })
        .eq("orchestrator_run_id", competing.runId);
      assert.equal(competingReservations, 1);
      assert.equal(competingDispatches, 1);

      const conflict = await createProposal(
        service,
        workspaceId,
        projectId,
        actorId,
        "conflict"
      );
      await assert.rejects(
        confirm({
          ...conflict.input,
          idempotencyKey: concurrent.input.idempotencyKey,
        }),
        hasDatabaseMessage(
          "creator_direct_confirmation_idempotency_conflict"
        )
      );

      const legacy = await createProposal(
        service,
        workspaceId,
        projectId,
        actorId,
        "legacy-parity"
      );
      const { data: legacyRows, error: legacyError } = await service.rpc(
        "consume_creator_direct_proposal_gate",
        {
          p_gate_id: legacy.input.gateId,
          p_project_id: legacy.input.projectId,
          p_actor_id: legacy.input.actorId,
          p_request_digest: legacy.input.requestDigest,
          p_approved_max_usd: legacy.input.approvedMaxUsd,
          p_approval_token: legacy.input.approvalToken,
          p_idempotency_key: legacy.input.idempotencyKey,
        }
      );
      assert.equal(legacyError, null, legacyError?.message);
      assert.deepEqual(legacyRows, [
        {
          run_id: legacy.runId,
          consumed: true,
          dispatch_enqueued: true,
        },
      ]);
      const { count: legacyReservations } = await service
        .from("orchestrator_budget_reservations")
        .select("id", { count: "exact", head: true })
        .eq("orchestrator_run_id", legacy.runId);
      const { count: legacyDispatches } = await service
        .from("orchestrator_dispatches")
        .select("id", { count: "exact", head: true })
        .eq("orchestrator_run_id", legacy.runId);
      assert.equal(legacyReservations, directReservations);
      assert.equal(legacyDispatches, directDispatches);

      const rollback = await createProposal(
        service,
        workspaceId,
        projectId,
        actorId,
        "rollback"
      );
      const baseRunner = asRoleRunner(pool);
      const failingRunner: TransactionRunner = (operation, callback) =>
        baseRunner(operation, async (client) => {
          const failingClient = {
            query(sql: string, params?: readonly unknown[]) {
              if (/insert into public\.idempotency/i.test(sql)) {
                throw Object.assign(new Error("forced late failure"), {
                  code: "XX000",
                });
              }
              return client.query(sql, params ? [...params] : []);
            },
          } as unknown as PoolClient;
          return callback(failingClient);
        });
      await assert.rejects(
        createConfirmCreatorDirectProposal(failingRunner)(rollback.input),
        hasDatabaseMessage("forced late failure")
      );
      const { data: rolledBackGate } = await service
        .from("orchestrator_run_gates")
        .select("status,token_consumed_at")
        .eq("id", rollback.input.gateId)
        .single();
      assert.equal(rolledBackGate?.status, "reached");
      assert.equal(rolledBackGate?.token_consumed_at, null);
      const { count: rolledBackReservations } = await service
        .from("orchestrator_budget_reservations")
        .select("id", { count: "exact", head: true })
        .eq("orchestrator_run_id", rollback.runId);
      const { count: rolledBackDispatches } = await service
        .from("orchestrator_dispatches")
        .select("id", { count: "exact", head: true })
        .eq("orchestrator_run_id", rollback.runId);
      assert.equal(rolledBackReservations, 0);
      assert.equal(rolledBackDispatches, 0);
    } finally {
      await service.from("workspaces").delete().in("id", [
        workspaceId,
        otherWorkspaceId,
      ]);
      await service.from("users").delete().eq("id", actorId);
      await pool.query("revoke delete on public.projects from popcorn_api");
      await pool.query(
        "revoke popcorn_api_readiness_probe from popcorn_api"
      ).catch(() => undefined);
      await pool.query("drop role if exists popcorn_api_readiness_probe");
      await pool.query("revoke popcorn_api from postgres");
      await pool.end();
    }
  }
);
