// PR 5 acceptance (docs/scopes/specialist-agent-orchestration-prs.md):
// concurrent request/job crash-retry produces one action row and one provider
// launch, session claims are stable under concurrency, one immutable report
// action closes one domain run, direct completion never wakes a root, stale
// session-claim job finalization is fenced, and every generated asset is
// traceable through its primitive action and finite run to the trusted origin.
//
// These tests exercise the REAL store modules (domain-session-store, store.ts
// job/action/claim helpers) against the local Supabase stack. Local stack
// only — never the hosted project.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  ActionId,
  DomainReportV1,
  DomainTaskV1,
  OrchestratorRunId,
} from "@popcorn/shared/domain-agent-contract";

const localUrl = process.env.SUPABASE_URL ?? "";
const runLocalIntegration =
  process.env.RUN_LOCAL_DB_INTEGRATION === "1" &&
  /127\.0\.0\.1|localhost/.test(localUrl) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

const integrationTest = runLocalIntegration ? test : test.skip;

import {
  appendDomainReport,
  claimSessionRun,
  completeDomainRun,
  createDomainRun,
  getAgentSession,
  getRootRunFamily,
  getRunSessionClaim,
  isStaleSessionClaimError,
  listSessionRuns,
  releaseSessionRun,
} from "@/lib/api/v1/domain-session-store";
import {
  claimProviderJobExecution,
  completeProviderJobExecution,
  createAction,
  createJob,
  createOrGetJob,
  updateJob,
} from "@/lib/api/v1/store";
import { ApiError } from "@/lib/api/v1/errors";
import { withRetry } from "@/lib/orchestrator/retry";

function serviceClient(): SupabaseClient {
  return createClient(localUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

interface Fixture {
  service: SupabaseClient;
  workspaceId: string;
  projectId: string;
  rootRunId: string;
  delegationActionId: string;
  cleanup(): Promise<void>;
}

async function createFixture(label: string): Promise<Fixture> {
  const service = serviceClient();
  const suffix = randomUUID();
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const rootRunId = randomUUID();
  const delegationActionId = randomUUID();
  const userIds: string[] = [];

  const { error: workspaceError } = await service
    .from("workspaces")
    .insert({ id: workspaceId, name: `__pr5_${label}__${suffix}` });
  assert.equal(workspaceError, null, `create workspace: ${workspaceError?.message}`);
  const { error: projectError } = await service.from("projects").insert({
    id: projectId,
    workspace_id: workspaceId,
    name: `PR5 ${label} ${suffix}`,
    visibility: "private",
  });
  assert.equal(projectError, null, `create project: ${projectError?.message}`);
  const { error: rootError } = await service.from("orchestrator_runs").insert({
    id: rootRunId,
    project_id: projectId,
    status: "running",
    input_summary: `root run ${label}`,
  });
  assert.equal(rootError, null, `create root run: ${rootError?.message}`);
  const { error: delegationError } = await service.from("actions").insert({
    id: delegationActionId,
    project_id: projectId,
    orchestrator_run_id: rootRunId,
    tool: "delegate_visuals",
    status: "running",
  });
  assert.equal(delegationError, null, `create delegation action: ${delegationError?.message}`);

  return {
    service,
    workspaceId,
    projectId,
    rootRunId,
    delegationActionId,
    async cleanup() {
      await service.from("projects").delete().eq("id", projectId);
      await service.from("workspaces").delete().eq("id", workspaceId);
      if (userIds.length > 0) await service.from("users").delete().in("id", userIds);
    },
  };
}

function visualsTask(fixture: Pick<Fixture, "projectId" | "rootRunId" | "delegationActionId">): DomainTaskV1 {
  return {
    schemaVersion: "DomainTask.v1",
    domain: "visuals",
    taskKind: "visuals_production",
    objective: "Produce the visuals for the assignment",
    instruction: "Generate keyframes and clips for the targeted beats",
    targets: [{ kind: "project", projectId: fixture.projectId }],
    requiredOutputs: [{ kind: "clip", role: "primary", minimumCount: 1 }],
    allowedOutputKinds: ["keyframe", "clip"],
    creativeConstraints: { tone: "warm" },
    preserve: { assetIds: [], selections: [], fingerprints: [], pins: [] },
    candidateAffectedAssetIds: [],
    budgetUsd: 5,
    acceptanceCriteria: ["Every beat has a clip"],
    origin: {
      kind: "creative_director",
      rootRunId: fixture.rootRunId as OrchestratorRunId,
      rootActionId: fixture.delegationActionId as ActionId,
      creatorMessageId: randomUUID(),
    },
    responseRecipient: { kind: "creative_director" },
  };
}

function creatorDirectImageTask(projectId: string, actorId: string): DomainTaskV1 {
  return {
    schemaVersion: "DomainTask.v1",
    domain: "visuals",
    taskKind: "image_create",
    objective: "Create a standalone image",
    instruction: "Generate one image from the creator's prompt",
    targets: [{ kind: "project", projectId }],
    requiredOutputs: [{ kind: "image", role: "primary", minimumCount: 1 }],
    allowedOutputKinds: ["image"],
    creativeConstraints: {},
    preserve: { assetIds: [], selections: [], fingerprints: [], pins: [] },
    candidateAffectedAssetIds: [],
    budgetUsd: 1,
    acceptanceCriteria: ["One image exists"],
    origin: {
      kind: "creator_direct",
      actorId,
      creatorMessageId: randomUUID(),
      entrypoint: "asset_studio",
      requestDigest: randomUUID(),
      idempotencyKey: randomUUID(),
      approvalGateId: randomUUID(),
    },
    responseRecipient: { kind: "creator_conversation" },
    approvalContext: {
      proposalActionId: randomUUID() as ActionId,
      approvedBudgetUsd: 1,
      approvalFingerprint: "fp",
    },
  };
}

function doneReport(outputs: Array<{ assetId: string; intrinsicRole: string }>): DomainReportV1 {
  return {
    schemaVersion: "DomainReport.v1",
    outcome: {
      outcome: "done",
      outputs,
      changedSelections: [],
      acceptanceEvidence: [],
      sessionSummary: "Visuals turn complete.",
    },
  };
}

async function insertAsset(fixture: Fixture, createdByActionId?: string): Promise<string> {
  const assetId = randomUUID();
  const { error } = await fixture.service.from("assets").insert({
    id: assetId,
    workspace_id: fixture.workspaceId,
    project_id: fixture.projectId,
    kind: "brief",
    media: "data",
    content: { schema_version: "brief.v1", summary: "pr5 provenance asset" },
    filename: "pr5.json",
    source: {},
    ...(createdByActionId ? { created_by_action_id: createdByActionId } : {}),
  });
  assert.equal(error, null, `create asset: ${error?.message}`);
  return assetId;
}

integrationTest(
  "one logical invocation yields one action row and one provider launch across concurrent retries",
  async () => {
    const fixture = await createFixture("invocation");
    try {
      const actionId = randomUUID();
      const invocation = {
        id: actionId,
        projectId: fixture.projectId,
        orchestratorRunId: fixture.rootRunId,
        tool: "generate_clip",
        status: "running" as const,
        params: { prompt: "a clip" },
      };
      // Concurrent request/crash retries of the same reserved invocation.
      // Each writer uses the engine's bounded store retry (the production
      // path: recordInvocation runs inside withStoreRetry), so a transient
      // gateway blip costs a retry that reloads the same reserved action.
      const actions = await Promise.all(
        Array.from({ length: 8 }, () => withRetry(() => createAction(invocation)))
      );
      assert.ok(actions.every((action) => action.id === actionId));
      const { count: actionCount } = await fixture.service
        .from("actions")
        .select("id", { count: "exact", head: true })
        .eq("id", actionId);
      assert.equal(actionCount, 1, "exactly one action row for the reserved invocation");

      // A late retry with drifted params reloads the immutable original
      // instead of appending or rewriting audit fields.
      const replayed = await createAction({ ...invocation, params: { prompt: "DRIFTED" } });
      assert.deepEqual(replayed.params, { prompt: "a clip" });

      // Provider launch: the canonical action id is the tenant-scoped job
      // idempotency key, so concurrent launches converge on one job...
      const launches = await Promise.all(
        Array.from({ length: 8 }, () =>
          createOrGetJob({
            workspaceId: fixture.workspaceId,
            projectId: fixture.projectId,
            type: "asset_generation",
            actionId,
            idempotencyKey: `action:${actionId}`,
          })
        )
      );
      const jobIds = new Set(launches.map((launch) => launch.job.id));
      assert.equal(jobIds.size, 1, "concurrent launches converge on one provider job");
      assert.equal(launches.filter((launch) => launch.created).length, 1);
      const jobId = launches[0].job.id;

      // ...and the provider CAS claim admits exactly one executor.
      const staleBefore = new Date(Date.now() - 15 * 60_000).toISOString();
      const claims = await Promise.all(
        Array.from({ length: 4 }, () =>
          claimProviderJobExecution({
            workspaceId: fixture.workspaceId,
            projectId: fixture.projectId,
            jobId,
            staleBefore,
          })
        )
      );
      assert.equal(
        claims.filter((claim) => claim.state === "claimed").length,
        1,
        "exactly one claimant crosses the provider boundary"
      );
    } finally {
      await fixture.cleanup();
    }
  }
);

integrationTest("session claims are stable under concurrency", async () => {
  const fixture = await createFixture("claims");
  try {
    const task = visualsTask(fixture);
    const origin = {
      kind: "creative_director" as const,
      parentRunId: fixture.rootRunId,
      rootActionId: fixture.delegationActionId,
    };
    const runA = await createDomainRun({
      projectId: fixture.projectId,
      domain: "visuals",
      task,
      inputSummary: "assignment A",
      origin,
    });
    const runB = await createDomainRun({
      projectId: fixture.projectId,
      domain: "visuals",
      task,
      inputSummary: "assignment B",
      origin,
    });
    assert.equal(runA.agentSessionId, runB.agentSessionId, "one session per (project, domain)");
    assert.notEqual(runA.sessionSequence, runB.sessionSequence);
    const sessionId = runA.agentSessionId!;

    // A caller-reserved run id makes enqueue idempotently retryable.
    const reservedId = randomUUID();
    const first = await createDomainRun({
      id: reservedId,
      projectId: fixture.projectId,
      domain: "visuals",
      task,
      inputSummary: "reserved",
      origin,
    });
    const retried = await createDomainRun({
      id: reservedId,
      projectId: fixture.projectId,
      domain: "visuals",
      task,
      inputSummary: "reserved retry drifted",
      origin,
    });
    assert.equal(retried.id, first.id);
    assert.equal(retried.sessionSequence, first.sessionSequence);
    assert.equal(retried.inputSummary, "reserved", "retry reloads the immutable assignment");

    // Concurrent claimants: exactly one run wins the single execution slot.
    const claimInput = (runId: string) => ({
      projectId: fixture.projectId,
      sessionId,
      runId,
    });
    const [claimA, claimB] = await Promise.all([
      claimSessionRun(claimInput(runA.id)),
      claimSessionRun(claimInput(runB.id)),
    ]);
    const claimed = [claimA, claimB].filter((claim) => claim.state === "claimed");
    const held = [claimA, claimB].filter((claim) => claim.state === "held");
    assert.equal(claimed.length, 1, "one claim wins");
    assert.equal(held.length, 1, "the loser observes held");
    const winner = claimA.state === "claimed" ? runA : runB;
    const generation = claimed[0].state === "claimed" ? claimed[0].claimGeneration : 0;
    assert.ok(generation >= 1);

    // Idempotent re-claim by the owner keeps the generation.
    const reclaim = await claimSessionRun(claimInput(winner.id));
    assert.deepEqual(reclaim, { state: "claimed", claimGeneration: generation });

    // Release advances the durable generation and clears the slot.
    assert.equal(await releaseSessionRun(claimInput(winner.id)), true);
    assert.equal(await releaseSessionRun(claimInput(winner.id)), false, "release is one-shot");
    const session = await getAgentSession(fixture.projectId, "visuals");
    assert.equal(session?.activeRunId, null);
    assert.ok(session!.claimGeneration > generation, "ownership change advances the generation");

    // A terminal run cannot take the slot.
    await fixture.service
      .from("orchestrator_runs")
      .update({ status: "canceled", completed_at: new Date().toISOString() })
      .eq("id", winner.id);
    const terminalClaim = await claimSessionRun(claimInput(winner.id));
    assert.deepEqual(terminalClaim, { state: "terminal" });

    // A run outside the session is rejected outright.
    await assert.rejects(
      claimSessionRun(claimInput(fixture.rootRunId)),
      (err: unknown) => err instanceof ApiError && err.code === "database_error"
    );
  } finally {
    await fixture.cleanup();
  }
});

integrationTest("one immutable report action closes one domain run", async () => {
  const fixture = await createFixture("report");
  try {
    const run = await createDomainRun({
      projectId: fixture.projectId,
      domain: "visuals",
      task: visualsTask(fixture),
      inputSummary: "report assignment",
      origin: {
        kind: "creative_director",
        parentRunId: fixture.rootRunId,
        rootActionId: fixture.delegationActionId,
      },
    });
    const outputAssetId = await insertAsset(fixture);
    const reportActionId = randomUUID();

    // Completion without a report is refused: the report closes the run.
    await assert.rejects(
      completeDomainRun({ projectId: fixture.projectId, runId: run.id }),
      (err: unknown) => err instanceof ApiError && err.code === "validation_failed"
    );

    const appended = await appendDomainReport({
      projectId: fixture.projectId,
      runId: run.id,
      reportActionId,
      report: doneReport([{ assetId: outputAssetId, intrinsicRole: "primary" }]),
    });
    assert.deepEqual(appended, { reportActionId, created: true });

    // Ordered, role-preserving attribution rows exist for the report outputs.
    const { data: attribution } = await fixture.service
      .from("action_assets")
      .select("asset_id, direction, role, ordinal")
      .eq("action_id", reportActionId);
    assert.deepEqual(attribution, [
      { asset_id: outputAssetId, direction: "output", role: "primary", ordinal: 0 },
    ]);

    // Replaying the same logical report is a no-op...
    const replayed = await appendDomainReport({
      projectId: fixture.projectId,
      runId: run.id,
      reportActionId,
      report: doneReport([{ assetId: outputAssetId, intrinsicRole: "primary" }]),
    });
    assert.deepEqual(replayed, { reportActionId, created: false });

    // ...while a second distinct report surfaces the typed conflict.
    await assert.rejects(
      appendDomainReport({
        projectId: fixture.projectId,
        runId: run.id,
        report: doneReport([]),
      }),
      (err: unknown) =>
        err instanceof ApiError &&
        err.code === "idempotency_conflict" &&
        err.details?.reason === "domain_report_exists" &&
        err.details?.existingReportActionId === reportActionId
    );

    // Cross-project output references never reach the database.
    const other = await createFixture("report-other");
    try {
      const foreignAssetId = await insertAsset(other);
      await assert.rejects(
        appendDomainReport({
          projectId: fixture.projectId,
          runId: run.id,
          report: doneReport([{ assetId: foreignAssetId, intrinsicRole: "primary" }]),
        }),
        (err: unknown) => err instanceof ApiError && err.code === "validation_failed"
      );
    } finally {
      await other.cleanup();
    }
  } finally {
    await fixture.cleanup();
  }
});

integrationTest(
  "completion derives its recipient from the trusted origin and direct completion never wakes a root",
  async () => {
    const fixture = await createFixture("completion");
    try {
      // Root-origin child: completing wakes the parent exactly once.
      const rootChild = await createDomainRun({
        projectId: fixture.projectId,
        domain: "visuals",
        task: visualsTask(fixture),
        inputSummary: "root-origin assignment",
        origin: {
          kind: "creative_director",
          parentRunId: fixture.rootRunId,
          rootActionId: fixture.delegationActionId,
        },
      });
      await claimSessionRun({
        projectId: fixture.projectId,
        sessionId: rootChild.agentSessionId!,
        runId: rootChild.id,
      });
      await appendDomainReport({
        projectId: fixture.projectId,
        runId: rootChild.id,
        report: doneReport([]),
      });
      const wakes: string[] = [];
      const completion = await completeDomainRun({
        projectId: fixture.projectId,
        runId: rootChild.id,
        wakeParent: async (parentRunId) => {
          wakes.push(parentRunId);
        },
      });
      assert.equal(completion.completed, true);
      assert.equal(completion.recipient, "creative_director");
      assert.equal(completion.parentRunId, fixture.rootRunId);
      assert.equal(completion.run.status, "succeeded");
      assert.deepEqual(wakes, [fixture.rootRunId], "the parent wakes exactly once");

      // Repeated completion is idempotent: no second terminalize, no re-wake.
      const again = await completeDomainRun({
        projectId: fixture.projectId,
        runId: rootChild.id,
        wakeParent: async (parentRunId) => {
          wakes.push(parentRunId);
        },
      });
      assert.equal(again.completed, false);
      assert.deepEqual(wakes, [fixture.rootRunId]);

      // Active ownership was released by completion.
      const session = await getAgentSession(fixture.projectId, "visuals");
      assert.equal(session?.activeRunId, null);

      // Creator-direct child: recipient is the creator conversation and the
      // wake hook is structurally unreachable.
      const actorId = randomUUID();
      const { error: userError } = await fixture.service
        .from("users")
        .insert({ id: actorId, email: `pr5-${actorId}@example.test` });
      assert.equal(userError, null, `create user: ${userError?.message}`);
      const direct = await createDomainRun({
        projectId: fixture.projectId,
        domain: "visuals",
        task: creatorDirectImageTask(fixture.projectId, actorId),
        inputSummary: "creator-direct assignment",
        origin: {
          kind: "creator_direct",
          actorId,
          request: { requestDigest: "digest", entrypoint: "asset_studio" },
        },
      });
      await appendDomainReport({
        projectId: fixture.projectId,
        runId: direct.id,
        report: doneReport([]),
      });
      const directWakes: string[] = [];
      const directCompletion = await completeDomainRun({
        projectId: fixture.projectId,
        runId: direct.id,
        wakeParent: async (parentRunId) => {
          directWakes.push(parentRunId);
        },
      });
      assert.equal(directCompletion.completed, true);
      assert.equal(directCompletion.recipient, "creator_conversation");
      assert.equal(directCompletion.parentRunId, null);
      assert.deepEqual(directWakes, [], "direct completion never wakes a root");
      await fixture.service.from("users").delete().eq("id", actorId);
    } finally {
      await fixture.cleanup();
    }
  }
);

integrationTest(
  "a job launched under a session claim is fenced once the claim generation advances",
  async () => {
    const fixture = await createFixture("fencing");
    try {
      const run = await createDomainRun({
        projectId: fixture.projectId,
        domain: "visuals",
        task: visualsTask(fixture),
        inputSummary: "fenced assignment",
        origin: {
          kind: "creative_director",
          parentRunId: fixture.rootRunId,
          rootActionId: fixture.delegationActionId,
        },
      });
      const claim = await claimSessionRun({
        projectId: fixture.projectId,
        sessionId: run.agentSessionId!,
        runId: run.id,
      });
      assert.equal(claim.state, "claimed");
      const runClaim = await getRunSessionClaim(run.id);
      assert.equal(
        runClaim?.claimGeneration,
        claim.state === "claimed" ? claim.claimGeneration : -1
      );

      // Two provider jobs launched under the live claim, attributed to
      // primitive actions on the finite run.
      async function launchFencedJob(): Promise<string> {
        const actionId = randomUUID();
        await createAction({
          id: actionId,
          projectId: fixture.projectId,
          orchestratorRunId: run.id,
          tool: "generate_keyframe",
          status: "running",
          params: {},
        });
        const job = await createJob({
          workspaceId: fixture.workspaceId,
          projectId: fixture.projectId,
          type: "asset_generation",
          actionId,
          sessionClaimGeneration: runClaim!.claimGeneration,
        });
        return job.id;
      }
      const liveJobId = await launchFencedJob();
      const staleJobId = await launchFencedJob();

      // While the claim is current, finalization succeeds.
      const finalized = await updateJob(fixture.workspaceId, fixture.projectId, liveJobId, {
        status: "succeeded",
        result: { assetIds: [] },
      });
      assert.equal(finalized.status, "succeeded");

      // The recorded generation is immutable once launched.
      const { error: rewriteError } = await fixture.service
        .from("jobs")
        .update({ session_claim_generation: runClaim!.claimGeneration + 5 })
        .eq("id", staleJobId);
      assert.ok(rewriteError, "jobs.session_claim_generation cannot be rewritten");

      // Ownership changes (release advances the durable generation)...
      assert.equal(
        await releaseSessionRun({
          projectId: fixture.projectId,
          sessionId: run.agentSessionId!,
          runId: run.id,
        }),
        true
      );

      // ...so the stale worker cannot commit late through the store...
      await assert.rejects(
        updateJob(fixture.workspaceId, fixture.projectId, staleJobId, {
          status: "succeeded",
          result: { assetIds: [] },
        }),
        (err: unknown) => isStaleSessionClaimError(err)
      );

      // ...nor through the provider-claim completion path (the fence composes
      // with the CAS claim instead of replacing it).
      const providerClaim = await claimProviderJobExecution({
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectId,
        jobId: staleJobId,
        staleBefore: new Date(Date.now() - 15 * 60_000).toISOString(),
      });
      assert.equal(providerClaim.state, "claimed");
      await assert.rejects(
        completeProviderJobExecution({
          workspaceId: fixture.workspaceId,
          projectId: fixture.projectId,
          jobId: staleJobId,
          claimToken: providerClaim.claimToken!,
          status: "succeeded",
          result: { assetIds: [] },
          error: null,
        }),
        (err: unknown) => isStaleSessionClaimError(err)
      );

      // The new owner may still cancel the stale job for cleanup.
      const canceled = await updateJob(fixture.workspaceId, fixture.projectId, staleJobId, {
        status: "canceled",
      });
      assert.equal(canceled.status, "canceled");
    } finally {
      await fixture.cleanup();
    }
  }
);

integrationTest(
  "every generated asset traces through its primitive action and finite run to the trusted origin",
  async () => {
    const fixture = await createFixture("provenance");
    try {
      const run = await createDomainRun({
        projectId: fixture.projectId,
        domain: "visuals",
        task: visualsTask(fixture),
        inputSummary: "traceable assignment",
        origin: {
          kind: "creative_director",
          parentRunId: fixture.rootRunId,
          rootActionId: fixture.delegationActionId,
        },
      });
      const primitiveActionId = randomUUID();
      await createAction({
        id: primitiveActionId,
        projectId: fixture.projectId,
        orchestratorRunId: run.id,
        tool: "generate_keyframe",
        status: "applied",
        params: {},
      });
      const assetId = await insertAsset(fixture, primitiveActionId);
      const reportActionId = randomUUID();
      await appendDomainReport({
        projectId: fixture.projectId,
        runId: run.id,
        reportActionId,
        report: doneReport([{ assetId, intrinsicRole: "primary" }]),
      });

      // asset -> creating action -> finite run -> trusted origin, derived
      // through actions.orchestrator_run_id (no redundant columns anywhere).
      const { data: asset } = await fixture.service
        .from("assets")
        .select("created_by_action_id")
        .eq("id", assetId)
        .single();
      const { data: action } = await fixture.service
        .from("actions")
        .select("orchestrator_run_id")
        .eq("id", asset!.created_by_action_id)
        .single();
      assert.equal(action!.orchestrator_run_id, run.id);
      const { data: runRow } = await fixture.service
        .from("orchestrator_runs")
        .select("origin_kind, parent_run_id, root_action_id, agent_session_id")
        .eq("id", action!.orchestrator_run_id)
        .single();
      assert.equal(runRow!.origin_kind, "creative_director");
      assert.equal(runRow!.parent_run_id, fixture.rootRunId);
      assert.equal(runRow!.root_action_id, fixture.delegationActionId);

      // The root-family projection exposes the same lineage.
      const family = await getRootRunFamily(fixture.rootRunId);
      assert.equal(family.root.id, fixture.rootRunId);
      const child = family.children.find((candidate) => candidate.id === run.id);
      assert.ok(child, "the child domain run appears in the root family");
      assert.equal(child!.reportActionId, reportActionId);
      assert.equal(child!.report?.outcome.outcome, "done");

      // Role-aware history: the service view carries origin metadata, the
      // agent view is sanitized.
      const serviceHistory = await listSessionRuns(run.agentSessionId!, "service");
      const serviceEntry = serviceHistory.find((entry) => entry.runId === run.id);
      assert.equal(serviceEntry?.originKind, "creative_director");
      assert.ok(serviceEntry?.taskParams, "service history includes the raw task");
      assert.equal(serviceEntry?.reportActionId, reportActionId);

      const agentHistory = await listSessionRuns(run.agentSessionId!, "visuals");
      const agentEntry = agentHistory.find((entry) => entry.runId === run.id);
      assert.ok(agentEntry, "agent history includes the run");
      assert.equal(agentEntry!.report?.outcome.outcome, "done");
      assert.ok(!("taskParams" in agentEntry!), "raw task specs are service-only");
      assert.ok(!("originActorId" in agentEntry!), "actor metadata is service-only");
      assert.ok(!("originRequest" in agentEntry!), "request metadata is service-only");
    } finally {
      await fixture.cleanup();
    }
  }
);
