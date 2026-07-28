// PR 6 acceptance (docs/scopes/specialist-agent-orchestration-prs.md):
// a transport test executes root -> persistent session -> child orchestrator
// run -> fake terminal report action -> root resume across processes, then
// sends follow-up feedback through a successor run without duplication.
// Concurrent creation, reclaimed-lease, media-wait, callback, and report/wake
// races preserve one sequence owner, one report, and one parent wake.
//
// These tests exercise the REAL modules (domain-run-service, the root-only
// delegate adapters, domain-session-store, orchestrator-store dispatch claim)
// against the local Supabase stack, with a FAKE domain report producer at the
// transport boundary — production driveLoop report emission is PR 8; no domain
// profile is enabled here. Local stack only — never the hosted project.

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
  cancelDomainRun,
  continueDomainSession,
  dispatchDomainRun,
  finalizeDomainTurn,
  getSessionQueueState,
  isDomainRunLimitError,
  isStaleDomainTurnError,
  supersedeQueuedDomainRun,
} from "@/lib/orchestrator/domain-run-service";
import { createDelegateVisualsTool } from "@/lib/orchestrator-tools/delegate-domain";
import {
  claimOrchestratorDispatches,
  claimOrchestratorRunResume,
  releaseOrchestratorDispatch,
  resolveGate,
  type ClaimedOrchestratorDispatch,
} from "@/lib/api/v1/orchestrator-store";
import {
  claimSessionRun,
  getAgentSession,
  getDomainRun,
} from "@/lib/api/v1/domain-session-store";
import {
  createAction,
  createJob,
  getProjectRunGeneratedAsset,
  updateJob,
} from "@/lib/api/v1/store";
import { ApiError } from "@/lib/api/v1/errors";
import type { AuthContext } from "@/lib/api/v1/auth";

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
  cleanup(): Promise<void>;
}

async function createFixture(label: string): Promise<Fixture> {
  const service = serviceClient();
  const suffix = randomUUID();
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const rootRunId = randomUUID();

  const { error: workspaceError } = await service
    .from("workspaces")
    .insert({ id: workspaceId, name: `__pr6_${label}__${suffix}` });
  assert.equal(workspaceError, null, `create workspace: ${workspaceError?.message}`);
  const { error: projectError } = await service.from("projects").insert({
    id: projectId,
    workspace_id: workspaceId,
    name: `PR6 ${label} ${suffix}`,
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

  return {
    service,
    workspaceId,
    projectId,
    rootRunId,
    async cleanup() {
      await service.from("projects").delete().eq("id", projectId);
      await service.from("workspaces").delete().eq("id", workspaceId);
    },
  };
}

/** Simulate the engine's durable invocation reserve for a delegate tool. */
async function reserveDelegationAction(
  fixture: Fixture,
  tool: "delegate_visuals" | "delegate_audio" = "delegate_visuals"
): Promise<string> {
  const actionId = randomUUID();
  await createAction({
    id: actionId,
    projectId: fixture.projectId,
    orchestratorRunId: fixture.rootRunId,
    tool,
    status: "running",
    params: { objective: "produce the visuals" },
  });
  return actionId;
}

function visualsTask(fixture: Fixture, rootActionId: string): DomainTaskV1 {
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
      rootActionId: rootActionId as ActionId,
      creatorMessageId: randomUUID(),
    },
    responseRecipient: { kind: "creative_director" },
  };
}

function audioTask(fixture: Fixture, rootActionId: string): DomainTaskV1 {
  return {
    schemaVersion: "DomainTask.v1",
    domain: "audio",
    taskKind: "audio_production",
    objective: "Produce narration for the assignment",
    instruction: "Generate and fit narration for the targeted beats",
    targets: [{ kind: "project", projectId: fixture.projectId }],
    requiredOutputs: [{ kind: "audio_track", role: "narration", minimumCount: 1 }],
    allowedOutputKinds: ["audio_track"],
    creativeConstraints: { tone: "warm" },
    preserve: { assetIds: [], selections: [], fingerprints: [], pins: [] },
    candidateAffectedAssetIds: [],
    budgetUsd: 5,
    acceptanceCriteria: ["Narration is available for each beat"],
    origin: {
      kind: "creative_director",
      rootRunId: fixture.rootRunId as OrchestratorRunId,
      rootActionId: rootActionId as ActionId,
      creatorMessageId: randomUUID(),
    },
    responseRecipient: { kind: "creative_director" },
  };
}

function creatorDirectTask(
  fixture: Fixture,
  actorId: string,
  taskKind: "image_create" | "video_create" = "image_create",
  preserveAssetId?: string
): DomainTaskV1 {
  const image = taskKind === "image_create";
  return {
    schemaVersion: "DomainTask.v1",
    domain: "visuals",
    taskKind,
    objective: image ? "Create a standalone image" : "Create a standalone video",
    instruction: image
      ? "Generate one image from the creator's prompt"
      : "Generate one video from the creator's prompt",
    targets: [{ kind: "project", projectId: fixture.projectId }],
    requiredOutputs: [{
      kind: image ? "image" : "clip",
      role: "primary",
      minimumCount: 1,
    }],
    allowedOutputKinds: [image ? "image" : "clip"],
    creativeConstraints: {},
    preserve: {
      assetIds: preserveAssetId ? [preserveAssetId] : [],
      selections: [],
      fingerprints: [],
      pins: preserveAssetId
        ? [{ kind: "asset", id: preserveAssetId }]
        : [],
    },
    candidateAffectedAssetIds: [],
    budgetUsd: 1,
    acceptanceCriteria: [image ? "One image exists" : "One video exists"],
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
  } as DomainTaskV1;
}

function doneReport(
  outputs: Array<{ assetId: string; intrinsicRole: string }> = [],
  sessionSummary = "Visuals turn complete."
): DomainReportV1 {
  return {
    schemaVersion: "DomainReport.v1",
    outcome: {
      outcome: "done",
      outputs,
      changedSelections: [],
      acceptanceEvidence: [],
      sessionSummary,
    },
  };
}

function questionReport(fingerprint: string): DomainReportV1 {
  return {
    schemaVersion: "DomainReport.v1",
    outcome: {
      outcome: "question",
      question: "Warm sunset palette or cool dusk palette for the montage?",
      targets: [],
      options: [
        { id: "warm", label: "Warm sunset", tradeoff: "cozier, less contrast" },
        { id: "cool", label: "Cool dusk", tradeoff: "moodier, higher contrast" },
      ],
      fingerprint,
    },
  };
}

async function insertAsset(fixture: Fixture): Promise<string> {
  const assetId = randomUUID();
  const { error } = await fixture.service.from("assets").insert({
    id: assetId,
    workspace_id: fixture.workspaceId,
    project_id: fixture.projectId,
    kind: "brief",
    media: "data",
    content: { schema_version: "brief.v1", summary: "pr6 transport asset" },
    filename: "pr6.json",
    source: {},
  });
  assert.equal(error, null, `create asset: ${error?.message}`);
  return assetId;
}

/** Claim dispatches until the given run's dispatch is held by us (bounded). */
async function claimDispatchForRun(
  runId: string,
  leaseSeconds = 60
): Promise<ClaimedOrchestratorDispatch | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const claims = await claimOrchestratorDispatches(16, leaseSeconds);
    const mine = claims.find((claim) => claim.runId === runId);
    // Release foreign claims immediately so other suites are not starved.
    await Promise.all(
      claims
        .filter((claim) => claim.runId !== runId)
        .map((claim) =>
          releaseOrchestratorDispatch({ ...claim, delaySeconds: 0, completed: false })
        )
    );
    if (mine) return mine;
  }
  return null;
}

/** Undo the claim path's visibility backoff so a test can re-claim promptly. */
async function makeDispatchAvailable(fixture: Fixture, runId: string): Promise<void> {
  await fixture.service
    .from("orchestrator_dispatches")
    .update({ available_at: new Date().toISOString() })
    .eq("orchestrator_run_id", runId)
    .eq("status", "queued");
}

async function dispatchRow(fixture: Fixture, runId: string) {
  const { data } = await fixture.service
    .from("orchestrator_dispatches")
    .select("status, available_at, lease_token")
    .eq("orchestrator_run_id", runId)
    .maybeSingle();
  return data as { status: string; available_at: string; lease_token: string | null } | null;
}

// ---------------------------------------------------------------------------
// Transport acceptance
// ---------------------------------------------------------------------------

integrationTest(
  "root -> session -> child run -> fake report -> root resume -> successor without duplication",
  async () => {
    const fixture = await createFixture("transport");
    try {
      // 1. The root's delegate_visuals invocation (engine-reserved action) is
      //    dispatched through the REAL root-only adapter.
      const rootActionId = await reserveDelegationAction(fixture);
      const adapter = createDelegateVisualsTool();
      const auth: AuthContext = {
        mode: "local",
        actor: { id: "orchestrator", type: "local" },
        workspaceId: fixture.workspaceId,
        isLocal: true,
      };
      const delegated = await adapter.execute(
        adapter.parseInput({ objective: "Produce the visuals for scene 1" }),
        {
          auth,
          projectId: fixture.projectId,
          orchestratorRunId: fixture.rootRunId,
          actionId: rootActionId,
          toolCallId: rootActionId,
        }
      );
      assert.equal(delegated.status, "delegated");
      if (delegated.status !== "delegated") return;
      const childRunId = delegated.childRunId;

      // The root parks in the domain wait (engine behavior, emulated here at
      // the store boundary because no domain profile may drive in PR 6).
      await fixture.service
        .from("orchestrator_runs")
        .update({ status: "waiting", wait_reason: "domain" })
        .eq("id", fixture.rootRunId);

      // Replaying the SAME invocation returns the SAME identities.
      const replay = await adapter.execute(
        adapter.parseInput({ objective: "Produce the visuals for scene 1" }),
        {
          auth,
          projectId: fixture.projectId,
          orchestratorRunId: fixture.rootRunId,
          actionId: rootActionId,
          toolCallId: rootActionId,
        }
      );
      assert.equal(replay.status, "delegated");
      if (replay.status === "delegated") {
        assert.equal(replay.childRunId, childRunId);
        assert.equal(replay.sessionId, delegated.sessionId);
      }
      const { count: childCount } = await fixture.service
        .from("orchestrator_runs")
        .select("id", { count: "exact", head: true })
        .eq("root_action_id", rootActionId);
      assert.equal(childCount, 1, "one finite child run per delegation action");

      // 2. A worker process claims the child dispatch; the claim transaction
      //    reserves the session's single active slot and returns the durable
      //    claim generation.
      const claimed = await claimDispatchForRun(childRunId);
      assert.ok(claimed, "the child dispatch is claimable");
      assert.equal(claimed!.agentSessionId, delegated.sessionId);
      assert.ok((claimed!.sessionClaimGeneration ?? 0) >= 1);
      const session = await getAgentSession(fixture.projectId, "visuals");
      assert.equal(session?.activeRunId, childRunId);

      // 3. FAKE domain report producer finalizes the turn in one transaction.
      const outputAssetId = await insertAsset(fixture);
      const wakes: string[] = [];
      const finalization = await finalizeDomainTurn({
        projectId: fixture.projectId,
        runId: childRunId,
        report: doneReport([{ assetId: outputAssetId, intrinsicRole: "primary" }]),
        expectedClaimGeneration: claimed!.sessionClaimGeneration,
        onParentWake: (parentRunId) => {
          wakes.push(parentRunId);
        },
      });
      assert.equal(finalization.performed, true);
      assert.equal(finalization.recipient, "creative_director");
      assert.equal(finalization.parentRunId, fixture.rootRunId);
      assert.equal(finalization.wokeParent, true);
      assert.deepEqual(wakes, [fixture.rootRunId]);

      // Child terminal; slot released; delegation action applied with the
      // report outputs; ordered attribution exists; summary CAS advanced.
      const child = await getDomainRun(fixture.projectId, childRunId);
      assert.equal(child?.status, "succeeded");
      const releasedSession = await getAgentSession(fixture.projectId, "visuals");
      assert.equal(releasedSession?.activeRunId, null);
      assert.ok(
        releasedSession!.claimGeneration > claimed!.sessionClaimGeneration!,
        "finalization advanced the durable claim generation"
      );
      assert.equal(releasedSession?.summaryVersion, 1, "summary CAS applied");
      const { data: delegationAction } = await fixture.service
        .from("actions")
        .select("status, output_asset_ids")
        .eq("id", rootActionId)
        .single();
      assert.equal(delegationAction!.status, "applied");
      assert.deepEqual(delegationAction!.output_asset_ids, [outputAssetId]);
      const { data: attribution } = await fixture.service
        .from("action_assets")
        .select("asset_id, direction, role, ordinal")
        .eq("action_id", finalization.reportActionId);
      assert.deepEqual(attribution, [
        { asset_id: outputAssetId, direction: "output", role: "primary", ordinal: 0 },
      ]);

      // 4. Root resume across processes: the wake durably queued the root's
      //    dispatch; a fresh worker claims it and wins the resume claim.
      const rootClaim = await claimDispatchForRun(fixture.rootRunId);
      assert.ok(rootClaim, "the parent dispatch woke exactly once and is claimable");
      const resumed = await claimOrchestratorRunResume(fixture.rootRunId);
      assert.ok(resumed, "the waiting root flips to running exactly once");
      assert.equal(resumed!.status, "running");
      assert.equal(resumed!.waitReason, undefined, "the domain wait is cleared");
      await releaseOrchestratorDispatch({ ...rootClaim!, delaySeconds: 0, completed: true });

      // 5. Follow-up feedback: a question turn closes its run; the answer is a
      //    fingerprinted one-use successor with a NEW sequence — never an
      //    out-of-band message, and never a duplicate.
      const questionActionId = await reserveDelegationAction(fixture);
      const questionRun = await dispatchDomainRun({
        projectId: fixture.projectId,
        domain: "visuals",
        task: visualsTask(fixture, questionActionId),
        inputSummary: "palette question turn",
        origin: {
          kind: "creative_director",
          parentRunId: fixture.rootRunId,
          rootActionId: questionActionId,
        },
        idempotencyKey: `root-action:${questionActionId}`,
      });
      const questionClaim = await claimSessionRun({
        projectId: fixture.projectId,
        sessionId: questionRun.sessionId,
        runId: questionRun.runId,
      });
      assert.equal(questionClaim.state, "claimed");
      await finalizeDomainTurn({
        projectId: fixture.projectId,
        runId: questionRun.runId,
        report: questionReport("fp_palette_1"),
      });
      const { data: questionDelegation } = await fixture.service
        .from("actions")
        .select("status, error")
        .eq("id", questionActionId)
        .single();
      assert.equal(questionDelegation?.status, "failed");
      assert.deepEqual(
        (questionDelegation?.error as { domainReport?: unknown } | null)?.domainReport,
        questionReport("fp_palette_1"),
        "the parent receives the question, options, and fingerprint on resume"
      );

      const answerActionId = await reserveDelegationAction(fixture);
      // One immutable successor task: the idempotent replay must hash equal.
      const answerTask = visualsTask(fixture, answerActionId);
      // A stale fingerprint cannot resume changed work.
      await assert.rejects(
        continueDomainSession({
          projectId: fixture.projectId,
          continuesRunId: questionRun.runId,
          answerFingerprint: "fp_stale",
          task: answerTask,
          inputSummary: "warm palette confirmed",
          origin: {
            kind: "creative_director",
            parentRunId: fixture.rootRunId,
            rootActionId: answerActionId,
          },
          idempotencyKey: `root-action:${answerActionId}`,
        }),
        (err: unknown) => err instanceof ApiError && err.code === "validation_failed"
      );
      const successor = await continueDomainSession({
        projectId: fixture.projectId,
        continuesRunId: questionRun.runId,
        answerFingerprint: "fp_palette_1",
        task: answerTask,
        inputSummary: "warm palette confirmed",
        origin: {
          kind: "creative_director",
          parentRunId: fixture.rootRunId,
          rootActionId: answerActionId,
        },
        idempotencyKey: `root-action:${answerActionId}`,
      });
      assert.ok(successor.sessionSequence > questionRun.sessionSequence);
      const successorRun = await getDomainRun(fixture.projectId, successor.runId);
      assert.equal(successorRun?.continuesRunId, questionRun.runId);

      // Replaying the answer returns the SAME successor (no duplication)...
      const successorReplay = await continueDomainSession({
        projectId: fixture.projectId,
        continuesRunId: questionRun.runId,
        answerFingerprint: "fp_palette_1",
        task: answerTask,
        inputSummary: "warm palette confirmed",
        origin: {
          kind: "creative_director",
          parentRunId: fixture.rootRunId,
          rootActionId: answerActionId,
        },
        idempotencyKey: `root-action:${answerActionId}`,
      });
      assert.equal(successorReplay.runId, successor.runId);
      assert.equal(successorReplay.created, false);

      // ...and the one-successor invariant rejects a second distinct answer.
      const secondAnswerActionId = await reserveDelegationAction(fixture);
      await assert.rejects(
        continueDomainSession({
          projectId: fixture.projectId,
          continuesRunId: questionRun.runId,
          answerFingerprint: "fp_palette_1",
          task: visualsTask(fixture, secondAnswerActionId),
          inputSummary: "cool palette instead",
          origin: {
            kind: "creative_director",
            parentRunId: fixture.rootRunId,
            rootActionId: secondAnswerActionId,
          },
          idempotencyKey: `root-action:${secondAnswerActionId}`,
        }),
        (err: unknown) => err instanceof ApiError && err.code === "database_error"
      );
    } finally {
      await fixture.cleanup();
    }
  }
);

// ---------------------------------------------------------------------------
// Races
// ---------------------------------------------------------------------------

integrationTest("concurrent creation preserves one sequence owner", async () => {
  const fixture = await createFixture("create-race");
  try {
    const rootActionId = await reserveDelegationAction(fixture);
    const task = visualsTask(fixture, rootActionId);
    const dispatches = await Promise.all(
      Array.from({ length: 8 }, () =>
        dispatchDomainRun({
          projectId: fixture.projectId,
          domain: "visuals",
          task,
          inputSummary: "raced assignment",
          origin: {
            kind: "creative_director",
            parentRunId: fixture.rootRunId,
            rootActionId,
          },
          idempotencyKey: `root-action:${rootActionId}`,
        })
      )
    );
    const runIds = new Set(dispatches.map((dispatch) => dispatch.runId));
    const sequences = new Set(dispatches.map((dispatch) => dispatch.sessionSequence));
    assert.equal(runIds.size, 1, "all racers converge on one finite run");
    assert.equal(sequences.size, 1, "one session sequence owner");
    assert.equal(dispatches.filter((dispatch) => dispatch.created).length, 1);
    const { count } = await fixture.service
      .from("orchestrator_runs")
      .select("id", { count: "exact", head: true })
      .eq("root_action_id", rootActionId);
    assert.equal(count, 1);
    const { count: dispatchCount } = await fixture.service
      .from("orchestrator_dispatches")
      .select("id", { count: "exact", head: true })
      .eq("orchestrator_run_id", [...runIds][0]);
    assert.equal(dispatchCount, 1, "one dispatch row");

    // Reusing the key with changed input is rejected.
    await assert.rejects(
      dispatchDomainRun({
        projectId: fixture.projectId,
        domain: "visuals",
        task,
        inputSummary: "DRIFTED assignment",
        origin: {
          kind: "creative_director",
          parentRunId: fixture.rootRunId,
          rootActionId,
        },
        idempotencyKey: `root-action:${rootActionId}`,
      }),
      (err: unknown) =>
        err instanceof ApiError &&
        err.code === "idempotency_conflict" &&
        err.details?.reason === "domain_dispatch_input_changed"
    );
  } finally {
    await fixture.cleanup();
  }
});

integrationTest(
  "report/wake races and duplicate callbacks preserve one report and one parent wake",
  async () => {
    const fixture = await createFixture("finalize-race");
    try {
      const rootActionId = await reserveDelegationAction(fixture);
      const dispatch = await dispatchDomainRun({
        projectId: fixture.projectId,
        domain: "visuals",
        task: visualsTask(fixture, rootActionId),
        inputSummary: "raced finalization",
        origin: {
          kind: "creative_director",
          parentRunId: fixture.rootRunId,
          rootActionId,
        },
        idempotencyKey: `root-action:${rootActionId}`,
      });
      const claim = await claimSessionRun({
        projectId: fixture.projectId,
        sessionId: dispatch.sessionId,
        runId: dispatch.runId,
      });
      assert.equal(claim.state, "claimed");

      // Duplicate callback: the SAME logical report finalized concurrently
      // (deterministic report action id) — exactly one caller performs the
      // transition and the wake; the rest replay.
      const wakes: string[] = [];
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          finalizeDomainTurn({
            projectId: fixture.projectId,
            runId: dispatch.runId,
            report: doneReport(),
            onParentWake: (parentRunId) => {
              wakes.push(parentRunId);
            },
          })
        )
      );
      const fulfilled = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : []
      );
      assert.ok(fulfilled.length >= 1);
      assert.equal(
        fulfilled.filter((value) => value.performed).length,
        1,
        "exactly one finalization performs"
      );
      assert.equal(
        fulfilled.filter((value) => value.wokeParent).length,
        1,
        "exactly one parent wake"
      );
      assert.deepEqual(wakes, [fixture.rootRunId]);
      const { count: reportCount } = await fixture.service
        .from("actions")
        .select("id", { count: "exact", head: true })
        .eq("orchestrator_run_id", dispatch.runId)
        .eq("tool", "domain_report");
      assert.equal(reportCount, 1, "one immutable report");

      // A late report with a DIFFERENT id/payload is fenced.
      await assert.rejects(
        finalizeDomainTurn({
          projectId: fixture.projectId,
          runId: dispatch.runId,
          reportActionId: randomUUID(),
          report: doneReport([], "drifted late report"),
        }),
        (err: unknown) =>
          err instanceof ApiError && err.code === "idempotency_conflict"
      );
    } finally {
      await fixture.cleanup();
    }
  }
);

integrationTest(
  "a reclaimed dispatch lease cannot double-finalize: one report wins across workers",
  async () => {
    const fixture = await createFixture("reclaimed-lease");
    try {
      const rootActionId = await reserveDelegationAction(fixture);
      const dispatch = await dispatchDomainRun({
        projectId: fixture.projectId,
        domain: "visuals",
        task: visualsTask(fixture, rootActionId),
        inputSummary: "reclaimed lease assignment",
        origin: {
          kind: "creative_director",
          parentRunId: fixture.rootRunId,
          rootActionId,
        },
        idempotencyKey: `root-action:${rootActionId}`,
      });

      // Worker A claims with a 1-second lease, then stalls.
      const workerA = await claimDispatchForRun(dispatch.runId, 1);
      assert.ok(workerA);
      await new Promise((resolve) => setTimeout(resolve, 1_200));

      // Worker B reclaims the expired lease; the session slot is retained by
      // the SAME run (owner re-claim), so B holds the same claim generation.
      const workerB = await claimDispatchForRun(dispatch.runId, 60);
      assert.ok(workerB, "the expired lease is reclaimable");
      assert.notEqual(workerB!.leaseToken, workerA!.leaseToken);
      assert.equal(workerB!.sessionClaimGeneration, workerA!.sessionClaimGeneration);

      // A's stale lease can no longer release the dispatch row.
      await releaseOrchestratorDispatch({ ...workerA!, delaySeconds: 0, completed: true });
      const row = await dispatchRow(fixture, dispatch.runId);
      assert.equal(row?.status, "claimed", "the stale release was a no-op");
      assert.equal(row?.lease_token, workerB!.leaseToken);

      // Both workers race finalization with DIFFERENT report ids: exactly one
      // report exists afterwards and only one caller performed the wake.
      const attempts = await Promise.allSettled([
        finalizeDomainTurn({
          projectId: fixture.projectId,
          runId: dispatch.runId,
          reportActionId: randomUUID(),
          report: doneReport([], "worker A result"),
          expectedClaimGeneration: workerA!.sessionClaimGeneration,
        }),
        finalizeDomainTurn({
          projectId: fixture.projectId,
          runId: dispatch.runId,
          reportActionId: randomUUID(),
          report: doneReport([], "worker B result"),
          expectedClaimGeneration: workerB!.sessionClaimGeneration,
        }),
      ]);
      const wins = attempts.flatMap((attempt) =>
        attempt.status === "fulfilled" && attempt.value.performed ? [attempt.value] : []
      );
      const losses = attempts.filter((attempt) => attempt.status === "rejected");
      assert.equal(wins.length, 1, "one worker wins the terminal transition");
      assert.equal(losses.length, 1, "the other is rejected, not silently merged");
      assert.equal(wins[0].wokeParent, true);
      const { count: reportCount } = await fixture.service
        .from("actions")
        .select("id", { count: "exact", head: true })
        .eq("orchestrator_run_id", dispatch.runId)
        .eq("tool", "domain_report");
      assert.equal(reportCount, 1, "one immutable report across reclaimed workers");
    } finally {
      await fixture.cleanup();
    }
  }
);

integrationTest(
  "an active run retains session ownership across media-job waits and its jobs stay fenced",
  async () => {
    const fixture = await createFixture("media-wait");
    try {
      const rootActionId = await reserveDelegationAction(fixture);
      const dispatch = await dispatchDomainRun({
        projectId: fixture.projectId,
        domain: "visuals",
        task: visualsTask(fixture, rootActionId),
        inputSummary: "media wait assignment",
        origin: {
          kind: "creative_director",
          parentRunId: fixture.rootRunId,
          rootActionId,
        },
        idempotencyKey: `root-action:${rootActionId}`,
      });
      const first = await claimDispatchForRun(dispatch.runId);
      assert.ok(first);
      const generation = first!.sessionClaimGeneration!;

      // Launch a provider job under the live claim (media-job wait), park the
      // dispatch (worker releases without completing)...
      const primitiveActionId = randomUUID();
      await createAction({
        id: primitiveActionId,
        projectId: fixture.projectId,
        orchestratorRunId: dispatch.runId,
        tool: "generate_keyframe",
        status: "running",
        params: {},
      });
      const job = await createJob({
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectId,
        type: "asset_generation",
        actionId: primitiveActionId,
        sessionClaimGeneration: generation,
      });
      await releaseOrchestratorDispatch({ ...first!, delaySeconds: 0, completed: false });

      // ...ownership is retained: the session slot still belongs to the run
      // and a re-claim (job completion wake) keeps the SAME generation.
      const midWait = await getAgentSession(fixture.projectId, "visuals");
      assert.equal(midWait?.activeRunId, dispatch.runId);
      const second = await claimDispatchForRun(dispatch.runId);
      assert.ok(second);
      assert.equal(second!.sessionClaimGeneration, generation);

      // The job finalizes under the retained claim...
      const finalized = await updateJob(fixture.workspaceId, fixture.projectId, job.id, {
        status: "succeeded",
        result: { assetIds: [] },
      });
      assert.equal(finalized.status, "succeeded");

      // ...and once the turn finalizes (generation advances), a stale job
      // launched under the old claim can no longer commit.
      const staleJob = await createJob({
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectId,
        type: "asset_generation",
        actionId: primitiveActionId,
        idempotencyKey: `stale:${primitiveActionId}`,
        sessionClaimGeneration: generation,
      });
      await finalizeDomainTurn({
        projectId: fixture.projectId,
        runId: dispatch.runId,
        report: doneReport(),
        expectedClaimGeneration: generation,
      });
      await assert.rejects(
        updateJob(fixture.workspaceId, fixture.projectId, staleJob.id, {
          status: "succeeded",
          result: { assetIds: [] },
        }),
        (err: unknown) => isStaleDomainTurnError(err)
      );
    } finally {
      await fixture.cleanup();
    }
  }
);

// ---------------------------------------------------------------------------
// Serialization, queue policy, and fences
// ---------------------------------------------------------------------------

integrationTest(
  "one session serializes across origins with visible queued state; direct work cannot supersede orchestrated work",
  async () => {
    const fixture = await createFixture("serialize");
    try {
      const actorId = randomUUID();
      const { error: userError } = await fixture.service
        .from("users")
        .insert({ id: actorId, email: `pr6-${actorId}@example.test` });
      assert.equal(userError, null, `create user: ${userError?.message}`);
      const videoPreserveAssetId = randomUUID();
      const { error: preserveAssetError } = await fixture.service
        .from("assets")
        .insert({
          id: videoPreserveAssetId,
          schema_version: "asset.v2",
          workspace_id: fixture.workspaceId,
          project_id: fixture.projectId,
          kind: "image",
          media: "image",
          status: "ready",
          role: "standalone_image",
          filename: "video-preserve-reference.png",
          source: { type: "generated" },
          content_hash: "video-preserve-hash",
        });
      assert.equal(
        preserveAssetError,
        null,
        `create preserve asset: ${preserveAssetError?.message}`
      );

      // Root-origin run takes the slot.
      const rootActionId = await reserveDelegationAction(fixture);
      const rootChild = await dispatchDomainRun({
        projectId: fixture.projectId,
        domain: "visuals",
        task: visualsTask(fixture, rootActionId),
        inputSummary: "orchestrated assignment",
        origin: {
          kind: "creative_director",
          parentRunId: fixture.rootRunId,
          rootActionId,
        },
        idempotencyKey: `root-action:${rootActionId}`,
      });
      const rootClaim = await claimDispatchForRun(rootChild.runId);
      assert.ok(rootClaim);

      // Creator-direct work in the SAME session queues behind it.
      const direct = await dispatchDomainRun({
        projectId: fixture.projectId,
        domain: "visuals",
        task: creatorDirectTask(fixture, actorId),
        inputSummary: "creator-direct image",
        origin: {
          kind: "creator_direct",
          actorId,
          request: { requestDigest: "digest", entrypoint: "asset_studio" },
        },
        idempotencyKey: `creator:${actorId}:image-1`,
      });
      assert.equal(direct.sessionId, rootChild.sessionId, "one session per (project, domain)");
      const blockedClaim = await claimDispatchForRun(direct.runId);
      assert.equal(blockedClaim, null, "the held session admits no second active run");
      const queue = await getSessionQueueState(fixture.projectId, "visuals");
      assert.equal(queue?.activeRunId, rootChild.runId);
      const queuedEntry = queue?.queue.find((entry) => entry.runId === direct.runId);
      assert.equal(queuedEntry?.status, "queued", "queued state is visible");
      assert.equal(queuedEntry?.active, false);

      // Creator-direct work cannot supersede the orchestrated run...
      await assert.rejects(
        supersedeQueuedDomainRun({
          projectId: fixture.projectId,
          runId: rootChild.runId,
          origin: { kind: "creator_direct" },
        }),
        (err: unknown) => err instanceof ApiError && err.code === "forbidden"
      );
      // ...and the orchestrated run's assignment identity (including pins)
      // survives the queued direct work untouched.
      const rootChildRow = await getDomainRun(fixture.projectId, rootChild.runId);
      assert.equal(rootChildRow?.originKind, "creative_director");
      assert.notEqual(rootChildRow?.status, "superseded");

      // Once the orchestrated turn finalizes, the direct run becomes claimable.
      await finalizeDomainTurn({
        projectId: fixture.projectId,
        runId: rootChild.runId,
        report: doneReport(),
        expectedClaimGeneration: rootClaim!.sessionClaimGeneration,
      });
      await makeDispatchAvailable(fixture, direct.runId);
      const directClaim = await claimDispatchForRun(direct.runId);
      assert.ok(directClaim, "the queued direct run claims the freed slot");

      // Creator-direct completion mutates no parent and wakes nothing.
      const directWakes: string[] = [];
      const directFinalization = await finalizeDomainTurn({
        projectId: fixture.projectId,
        runId: direct.runId,
        report: doneReport(),
        expectedClaimGeneration: directClaim!.sessionClaimGeneration,
        onParentWake: (parentRunId) => {
          directWakes.push(parentRunId);
        },
      });
      assert.equal(directFinalization.recipient, "creator_conversation");
      assert.equal(directFinalization.parentRunId, null);
      assert.equal(directFinalization.wokeParent, false);
      assert.deepEqual(directWakes, [], "direct completion never wakes a root");

      // A later creator-direct video reuses this exact Visuals session while
      // retaining its own task/pin envelope.
      const directVideo = await dispatchDomainRun({
        projectId: fixture.projectId,
        domain: "visuals",
        task: creatorDirectTask(
          fixture,
          actorId,
          "video_create",
          videoPreserveAssetId
        ),
        inputSummary: "creator-direct video",
        origin: {
          kind: "creator_direct",
          actorId,
          request: { requestDigest: "digest-video", entrypoint: "asset_studio" },
        },
        idempotencyKey: `creator:${actorId}:video-1`,
      });
      assert.equal(directVideo.sessionId, rootChild.sessionId);
      await makeDispatchAvailable(fixture, directVideo.runId);
      const directVideoClaim = await claimDispatchForRun(directVideo.runId);
      assert.ok(directVideoClaim);
      const directVideoRow = await getDomainRun(
        fixture.projectId,
        directVideo.runId
      );
      assert.equal(directVideoRow?.taskKind, "video_create");
      assert.deepEqual(
        directVideoRow?.taskParams?.preserve.assetIds,
        [videoPreserveAssetId]
      );
      const unchangedRoot = await getDomainRun(
        fixture.projectId,
        rootChild.runId
      );
      assert.deepEqual(unchangedRoot?.taskParams?.preserve.assetIds, []);
      await finalizeDomainTurn({
        projectId: fixture.projectId,
        runId: directVideo.runId,
        report: doneReport(),
        expectedClaimGeneration:
          directVideoClaim!.sessionClaimGeneration,
      });

      // Same-origin supersession of a QUEUED run works; late reports to the
      // superseded run are fenced.
      const supersededTarget = await dispatchDomainRun({
        projectId: fixture.projectId,
        domain: "visuals",
        task: creatorDirectTask(fixture, actorId),
        inputSummary: "to be superseded",
        origin: {
          kind: "creator_direct",
          actorId,
          request: { requestDigest: "digest-2", entrypoint: "asset_studio" },
        },
        idempotencyKey: `creator:${actorId}:image-2`,
      });
      assert.equal(
        await supersedeQueuedDomainRun({
          projectId: fixture.projectId,
          runId: supersededTarget.runId,
          origin: { kind: "creator_direct" },
        }),
        true
      );
      await assert.rejects(
        finalizeDomainTurn({
          projectId: fixture.projectId,
          runId: supersededTarget.runId,
          report: doneReport(),
        }),
        (err: unknown) => isStaleDomainTurnError(err)
      );

      await fixture.service.from("users").delete().eq("id", actorId);
    } finally {
      await fixture.cleanup();
    }
  }
);

integrationTest(
  "cancellation fences late reports and retires the dispatch; gated quotes never occupy the slot",
  async () => {
    const fixture = await createFixture("cancel-gate");
    try {
      // Cancellation fence.
      const rootActionId = await reserveDelegationAction(fixture);
      const child = await dispatchDomainRun({
        projectId: fixture.projectId,
        domain: "visuals",
        task: visualsTask(fixture, rootActionId),
        inputSummary: "to be canceled",
        origin: {
          kind: "creative_director",
          parentRunId: fixture.rootRunId,
          rootActionId,
        },
        idempotencyKey: `root-action:${rootActionId}`,
      });
      const claim = await claimSessionRun({
        projectId: fixture.projectId,
        sessionId: child.sessionId,
        runId: child.runId,
      });
      assert.equal(claim.state, "claimed");
      const claimGeneration = claim.claimGeneration!;
      const providerActionId = randomUUID();
      await createAction({
        id: providerActionId,
        projectId: fixture.projectId,
        orchestratorRunId: child.runId,
        tool: "generate_keyframe",
        status: "running",
        params: {},
      });
      const providerJob = await createJob({
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectId,
        type: "asset_generation",
        actionId: providerActionId,
        sessionClaimGeneration: claimGeneration,
      });
      assert.equal(
        await cancelDomainRun({ projectId: fixture.projectId, runId: child.runId }),
        true
      );
      const canceled = await getDomainRun(fixture.projectId, child.runId);
      assert.equal(canceled?.status, "canceled");
      const session = await getAgentSession(fixture.projectId, "visuals");
      assert.equal(session?.activeRunId, null, "cancellation releases the slot");
      assert.ok(
        session!.claimGeneration > claimGeneration,
        "cancellation advances the durable generation inside the terminal transaction"
      );
      const { data: canceledJob } = await fixture.service
        .from("jobs")
        .select("status")
        .eq("id", providerJob.id)
        .single();
      assert.equal(canceledJob?.status, "canceled", "causal provider jobs cancel atomically");
      await assert.rejects(
        finalizeDomainTurn({
          projectId: fixture.projectId,
          runId: child.runId,
          report: doneReport(),
        }),
        (err: unknown) => isStaleDomainTurnError(err)
      );
      // The dispatch for the canceled run is retired by the claim path.
      const canceledClaim = await claimDispatchForRun(child.runId);
      assert.equal(canceledClaim, null);
      const retired = await dispatchRow(fixture, child.runId);
      assert.equal(retired?.status, "completed");

      // Cancellation and finalization contend on the same run/session locks.
      // Exactly one terminal transition wins, and neither outcome strands the
      // durable session claim.
      const raceActionId = await reserveDelegationAction(fixture);
      const race = await dispatchDomainRun({
        projectId: fixture.projectId,
        domain: "visuals",
        task: visualsTask(fixture, raceActionId),
        inputSummary: "cancel/finalize race",
        origin: {
          kind: "creative_director",
          parentRunId: fixture.rootRunId,
          rootActionId: raceActionId,
        },
        idempotencyKey: `root-action:${raceActionId}`,
      });
      const raceClaim = await claimSessionRun({
        projectId: fixture.projectId,
        sessionId: race.sessionId,
        runId: race.runId,
      });
      assert.equal(raceClaim.state, "claimed");
      const raceAttempts = await Promise.allSettled([
        cancelDomainRun({ projectId: fixture.projectId, runId: race.runId }),
        finalizeDomainTurn({
          projectId: fixture.projectId,
          runId: race.runId,
          report: doneReport(),
          expectedClaimGeneration: raceClaim.claimGeneration,
        }),
      ]);
      const winners = raceAttempts.flatMap((attempt) => {
        if (attempt.status !== "fulfilled") return [];
        return typeof attempt.value === "boolean"
          ? attempt.value
            ? ["canceled"]
            : []
          : attempt.value.performed
            ? ["finalized"]
            : [];
      });
      assert.equal(winners.length, 1, "exactly one terminal transition wins the race");
      const racedSession = await getAgentSession(fixture.projectId, "visuals");
      assert.equal(racedSession?.activeRunId, null, "the race cannot strand session ownership");
      assert.ok(racedSession!.claimGeneration > raceClaim.claimGeneration);

      // Unconfirmed quote: a pending gate keeps the run out of the slot.
      const gatedActionId = await reserveDelegationAction(fixture);
      const gated = await dispatchDomainRun({
        projectId: fixture.projectId,
        domain: "visuals",
        task: visualsTask(fixture, gatedActionId),
        inputSummary: "gated quote",
        origin: {
          kind: "creative_director",
          parentRunId: fixture.rootRunId,
          rootActionId: gatedActionId,
        },
        gateStage: "proposal",
        idempotencyKey: `root-action:${gatedActionId}`,
      });
      assert.ok(gated.gateId, "the required gate is persisted with creation");
      const gatedClaim = await claimDispatchForRun(gated.runId);
      assert.equal(gatedClaim, null, "an unconfirmed quote never occupies the slot");
      const gatedSession = await getAgentSession(fixture.projectId, "visuals");
      assert.equal(gatedSession?.activeRunId, null);

      // Approving the gate makes it claimable.
      await resolveGate(gated.gateId!, "approved");
      await makeDispatchAvailable(fixture, gated.runId);
      const confirmedClaim = await claimDispatchForRun(gated.runId);
      assert.ok(confirmedClaim, "a confirmed run claims normally");
    } finally {
      await fixture.cleanup();
    }
  }
);

integrationTest(
  "run-scoped pooled prerequisites never rejoin from a different run",
  async () => {
    const fixture = await createFixture("run-scoped-prerequisite");
    try {
      const otherRunId = randomUUID();
      const { error: otherRunError } = await fixture.service
        .from("orchestrator_runs")
        .insert({
          id: otherRunId,
          project_id: fixture.projectId,
          status: "running",
          input_summary: "other run",
        });
      assert.equal(otherRunError, null, `create other run: ${otherRunError?.message}`);

      const requestedAction = await createAction({
        projectId: fixture.projectId,
        orchestratorRunId: fixture.rootRunId,
        tool: "generate_keyframe",
        status: "applied",
      });
      const otherAction = await createAction({
        projectId: fixture.projectId,
        orchestratorRunId: otherRunId,
        tool: "generate_keyframe",
        status: "applied",
      });
      const requestedAssetId = randomUUID();
      const otherAssetId = randomUUID();
      const rows = [
        {
          id: requestedAssetId,
          schema_version: "asset.v2",
          workspace_id: fixture.workspaceId,
          project_id: fixture.projectId,
          kind: "keyframe",
          media: "image",
          status: "ready",
          role: "beat_keyframe",
          filename: "requested-keyframe.png",
          source: { type: "generated" },
          params: {
            schema_version: "generated_asset_params.v1",
            provenance: { provider: "mock", prompt: "requested", beatId: "beat_1" },
          },
          content_hash: "requested-keyframe-hash",
          created_by_action_id: requestedAction.id,
        },
        {
          id: otherAssetId,
          schema_version: "asset.v2",
          workspace_id: fixture.workspaceId,
          project_id: fixture.projectId,
          kind: "keyframe",
          media: "image",
          status: "ready",
          role: "beat_keyframe",
          filename: "other-keyframe.png",
          source: { type: "generated" },
          params: {
            schema_version: "generated_asset_params.v1",
            provenance: { provider: "mock", prompt: "other", beatId: "beat_1" },
          },
          content_hash: "other-keyframe-hash",
          created_by_action_id: otherAction.id,
        },
      ];
      const { error: assetError } = await fixture.service.from("assets").insert(rows);
      assert.equal(assetError, null, `create pooled keyframes: ${assetError?.message}`);

      const requested = await getProjectRunGeneratedAsset({
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectId,
        orchestratorRunId: fixture.rootRunId,
        role: "beat_keyframe",
        beatId: "beat_1",
      });
      const other = await getProjectRunGeneratedAsset({
        workspaceId: fixture.workspaceId,
        projectId: fixture.projectId,
        orchestratorRunId: otherRunId,
        role: "beat_keyframe",
        beatId: "beat_1",
      });

      assert.equal(requested?.id, requestedAssetId);
      assert.equal(other?.id, otherAssetId);
    } finally {
      await fixture.cleanup();
    }
  }
);

integrationTest("fan-out, continuation, and bounce limits are enforced", async () => {
  const fixture = await createFixture("limits");
  try {
    // Per-root child-run limit.
    const firstActionId = await reserveDelegationAction(fixture);
    await dispatchDomainRun({
      projectId: fixture.projectId,
      domain: "visuals",
      task: visualsTask(fixture, firstActionId),
      inputSummary: "first child",
      origin: {
        kind: "creative_director",
        parentRunId: fixture.rootRunId,
        rootActionId: firstActionId,
      },
      idempotencyKey: `root-action:${firstActionId}`,
    });
    const secondActionId = await reserveDelegationAction(fixture);
    await assert.rejects(
      dispatchDomainRun({
        projectId: fixture.projectId,
        domain: "visuals",
        task: visualsTask(fixture, secondActionId),
        inputSummary: "over the child limit",
        origin: {
          kind: "creative_director",
          parentRunId: fixture.rootRunId,
          rootActionId: secondActionId,
        },
        idempotencyKey: `root-action:${secondActionId}`,
        limits: { maxChildRunsPerRoot: 1 },
      }),
      (err: unknown) => isDomainRunLimitError(err)
    );

    // Bounce guard: repeated blocked reports on ONE requirement stop dispatch.
    const blockedReport: DomainReportV1 = {
      schemaVersion: "DomainReport.v1",
      outcome: {
        outcome: "blocked",
        precondition: {
          requirement: "narration_track",
          because: "fitting the montage needs narration that does not exist",
        },
        requiredDomain: "audio",
        targets: [],
        reason: "narration missing",
      },
    };
    const runs: string[] = [];
    let allowedRetry: Awaited<ReturnType<typeof continueDomainSession>> | undefined;
    let allowedRetryActionId: string | undefined;
    let allowedRetryTask: DomainTaskV1 | undefined;
    for (let index = 0; index < 2; index += 1) {
      const actionId = await reserveDelegationAction(fixture);
      const dispatched = await dispatchDomainRun({
        projectId: fixture.projectId,
        domain: "visuals",
        task: visualsTask(fixture, actionId),
        inputSummary: `blocked turn ${index}`,
        origin: {
          kind: "creative_director",
          parentRunId: fixture.rootRunId,
          rootActionId: actionId,
        },
        idempotencyKey: `root-action:${actionId}`,
      });
      runs.push(dispatched.runId);
      const claim = await claimSessionRun({
        projectId: fixture.projectId,
        sessionId: dispatched.sessionId,
        runId: dispatched.runId,
      });
      assert.equal(claim.state, "claimed");
      await finalizeDomainTurn({
        projectId: fixture.projectId,
        runId: dispatched.runId,
        report: blockedReport,
      });
      if (index === 0) {
        const { data: blockedDelegation } = await fixture.service
          .from("actions")
          .select("status, error")
          .eq("id", actionId)
          .single();
        assert.equal(blockedDelegation?.status, "failed");
        const blockedError = blockedDelegation?.error as {
          domainReport?: unknown;
          unmetRequirements?: unknown;
          suggestedNextTools?: unknown;
        } | null;
        assert.deepEqual(blockedError?.domainReport, blockedReport);
        assert.ok(Array.isArray(blockedError?.unmetRequirements));
        assert.ok(Array.isArray(blockedError?.suggestedNextTools));
        allowedRetryActionId = await reserveDelegationAction(fixture);
        allowedRetryTask = visualsTask(fixture, allowedRetryActionId);
        allowedRetry = await continueDomainSession({
          projectId: fixture.projectId,
          continuesRunId: dispatched.runId,
          task: allowedRetryTask,
          inputSummary: "first retry of the blocked narration requirement",
          origin: {
            kind: "creative_director",
            parentRunId: fixture.rootRunId,
            rootActionId: allowedRetryActionId,
          },
          idempotencyKey: `root-action:${allowedRetryActionId}`,
          limits: { maxBlockedReportsPerRequirement: 2, maxContinuationChain: 99 },
        });
      }
    }

    // Two Visuals reports blocked on narration MUST NOT prevent the root from
    // dispatching Audio to satisfy the prerequisite.
    const siblingActionId = await reserveDelegationAction(fixture, "delegate_audio");
    const sibling = await dispatchDomainRun({
      projectId: fixture.projectId,
      domain: "audio",
      task: audioTask(fixture, siblingActionId),
      inputSummary: "produce the missing narration",
      origin: {
        kind: "creative_director",
        parentRunId: fixture.rootRunId,
        rootActionId: siblingActionId,
      },
      idempotencyKey: `root-action:${siblingActionId}`,
      limits: { maxBlockedReportsPerRequirement: 2 },
    });
    assert.equal(sibling.created, true, "the unrelated sibling dispatch remains available");

    // An existing allowed continuation still replays after the requirement's
    // count reaches its limit: the RPC returns before retry admission checks.
    assert.ok(allowedRetry && allowedRetryActionId && allowedRetryTask);
    const retryReplay = await continueDomainSession({
      projectId: fixture.projectId,
      continuesRunId: runs[0]!,
      task: allowedRetryTask,
      inputSummary: "first retry of the blocked narration requirement",
      origin: {
        kind: "creative_director",
        parentRunId: fixture.rootRunId,
        rootActionId: allowedRetryActionId,
      },
      idempotencyKey: `root-action:${allowedRetryActionId}`,
      limits: { maxBlockedReportsPerRequirement: 2, maxContinuationChain: 99 },
    });
    assert.equal(retryReplay.runId, allowedRetry.runId);
    assert.equal(retryReplay.created, false);

    // A NEW continuation of the exact exhausted requirement is refused.
    const bouncedActionId = await reserveDelegationAction(fixture);
    await assert.rejects(
      continueDomainSession({
        projectId: fixture.projectId,
        continuesRunId: runs[1]!,
        task: visualsTask(fixture, bouncedActionId),
        inputSummary: "third retry of the same blocked requirement",
        origin: {
          kind: "creative_director",
          parentRunId: fixture.rootRunId,
          rootActionId: bouncedActionId,
        },
        idempotencyKey: `root-action:${bouncedActionId}`,
        limits: { maxBlockedReportsPerRequirement: 2, maxContinuationChain: 99 },
      }),
      (err: unknown) => isDomainRunLimitError(err)
    );

    // Continuation chain limit.
    const chainAnswerActionId = await reserveDelegationAction(fixture);
    await assert.rejects(
      continueDomainSession({
        projectId: fixture.projectId,
        continuesRunId: runs[1],
        task: visualsTask(fixture, chainAnswerActionId),
        inputSummary: "answer over the chain limit",
        origin: {
          kind: "creative_director",
          parentRunId: fixture.rootRunId,
          rootActionId: chainAnswerActionId,
        },
        idempotencyKey: `root-action:${chainAnswerActionId}`,
        limits: { maxContinuationChain: 1, maxBlockedReportsPerRequirement: 99 },
      }),
      (err: unknown) => isDomainRunLimitError(err)
    );
  } finally {
    await fixture.cleanup();
  }
});
