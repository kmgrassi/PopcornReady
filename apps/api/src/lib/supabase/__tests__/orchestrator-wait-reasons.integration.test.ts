import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  ActionId,
  AgentDomain,
  DomainRunWaitReason,
  DomainTaskV1,
  OrchestratorRunId,
} from "@popcorn/shared/domain-agent-contract";
import {
  claimOrchestratorRunResume,
  updateOrchestratorRun,
} from "@/lib/api/v1/orchestrator-store";

const localUrl = process.env.SUPABASE_URL ?? "";
const runLocalIntegration =
  process.env.RUN_LOCAL_DB_INTEGRATION === "1" &&
  /127\.0\.0\.1|localhost/.test(localUrl) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

const integrationTest = runLocalIntegration ? test : test.skip;

interface SequenceAllocation {
  session_id: string;
  allocated_sequence: number;
}

interface Fixture {
  service: SupabaseClient;
  workspaceId: string;
  projectId: string;
  rootRunId: string;
  runIds: Record<AgentDomain, string>;
  cleanup(): Promise<void>;
}

function serviceClient(): SupabaseClient {
  return createClient(localUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

function assertNoError(
  error: { message: string } | null,
  operation: string
): asserts error is null {
  assert.equal(error, null, `${operation}: ${error?.message ?? "unknown error"}`);
}

function assertWaitReasonConstraint(
  error: { code?: string; message: string } | null,
  operation: string
): void {
  assert.ok(error, `${operation} must be rejected`);
  assert.equal(error.code, "23514", `${operation} must fail with check_violation`);
  assert.match(
    error.message,
    /orchestrator_runs_wait_reason_shape/,
    `${operation} must fail at the wait-reason constraint`
  );
}

function taskFor(input: {
  domain: AgentDomain;
  projectId: string;
  rootRunId: string;
  rootActionId: string;
}): DomainTaskV1 {
  if (input.domain === "visuals") {
    return {
      schemaVersion: "DomainTask.v1",
      domain: "visuals",
      taskKind: "visuals_production",
      objective: "Produce one visual asset.",
      instruction: "Generate the requested visual asset.",
      targets: [{ kind: "project", projectId: input.projectId }],
      requiredOutputs: [{ kind: "image", role: "primary", minimumCount: 1 }],
      allowedOutputKinds: ["image"],
      creativeConstraints: {},
      preserve: { assetIds: [], selections: [], fingerprints: [], pins: [] },
      candidateAffectedAssetIds: [],
      budgetUsd: 1,
      acceptanceCriteria: ["One visual asset exists."],
      origin: {
        kind: "creative_director",
        rootRunId: input.rootRunId as OrchestratorRunId,
        rootActionId: input.rootActionId as ActionId,
        creatorMessageId: randomUUID(),
      },
      responseRecipient: { kind: "creative_director" },
    };
  }
  return {
    schemaVersion: "DomainTask.v1",
    domain: "audio",
    taskKind: "audio_production",
    objective: "Produce one audio asset.",
    instruction: "Generate the requested audio asset.",
    targets: [{ kind: "project", projectId: input.projectId }],
    requiredOutputs: [{ kind: "audio_track", role: "primary", minimumCount: 1 }],
    allowedOutputKinds: ["audio_track"],
    creativeConstraints: {},
    preserve: { assetIds: [], selections: [], fingerprints: [], pins: [] },
    candidateAffectedAssetIds: [],
    budgetUsd: 1,
    acceptanceCriteria: ["One audio asset exists."],
    origin: {
      kind: "creative_director",
      rootRunId: input.rootRunId as OrchestratorRunId,
      rootActionId: input.rootActionId as ActionId,
      creatorMessageId: randomUUID(),
    },
    responseRecipient: { kind: "creative_director" },
  };
}

async function createFixture(label: string): Promise<Fixture> {
  const service = serviceClient();
  const suffix = randomUUID();
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const rootRunId = randomUUID();
  const rootActionIds: Record<AgentDomain, string> = {
    visuals: randomUUID(),
    audio: randomUUID(),
  };
  let workspaceCreated = false;
  let projectCreated = false;

  try {
    const { error: workspaceError } = await service
      .from("workspaces")
      .insert({ id: workspaceId, name: `__wait_reason_${label}__${suffix}` });
    workspaceCreated = workspaceError === null;
    assertNoError(workspaceError, "create workspace");
    const { error: projectError } = await service.from("projects").insert({
      id: projectId,
      workspace_id: workspaceId,
      name: `Wait reason ${label} ${suffix}`,
      visibility: "private",
    });
    projectCreated = projectError === null;
    assertNoError(projectError, "create project");
    const { error: rootError } = await service.from("orchestrator_runs").insert({
      id: rootRunId,
      project_id: projectId,
      status: "running",
      input_summary: `wait reason root ${label}`,
    });
    assertNoError(rootError, "create root run");
    const { error: actionError } = await service.from("actions").insert([
      {
        id: rootActionIds.visuals,
        project_id: projectId,
        orchestrator_run_id: rootRunId,
        tool: "delegate_visuals",
        status: "running",
      },
      {
        id: rootActionIds.audio,
        project_id: projectId,
        orchestrator_run_id: rootRunId,
        tool: "delegate_audio",
        status: "running",
      },
    ]);
    assertNoError(actionError, "create delegation actions");

    const runIds = {} as Record<AgentDomain, string>;
    for (const domain of ["visuals", "audio"] as const) {
      const allocation = await service.rpc("allocate_agent_session_sequence", {
        p_project_id: projectId,
        p_domain: domain,
      });
      assertNoError(allocation.error, `allocate ${domain} session sequence`);
      const sequence = (allocation.data as SequenceAllocation[])[0];
      assert.ok(sequence, `${domain} sequence allocation returned a row`);
      const runId = randomUUID();
      const task = taskFor({
        domain,
        projectId,
        rootRunId,
        rootActionId: rootActionIds[domain],
      });
      const { error: runError } = await service.from("orchestrator_runs").insert({
        id: runId,
        project_id: projectId,
        status: "running",
        input_summary: `${domain} wait reason assignment`,
        agent_role: domain,
        agent_session_id: sequence.session_id,
        session_sequence: sequence.allocated_sequence,
        task_kind: task.taskKind,
        task_params: task,
        origin_kind: "creative_director",
        parent_run_id: rootRunId,
        root_action_id: rootActionIds[domain],
      });
      assertNoError(runError, `create ${domain} run`);
      runIds[domain] = runId;
    }

    return {
      service,
      workspaceId,
      projectId,
      rootRunId,
      runIds,
      async cleanup() {
        const { error: cleanupProjectError } = await service
          .from("projects")
          .delete()
          .eq("id", projectId);
        assertNoError(cleanupProjectError, "delete project fixture");
        const { error: cleanupWorkspaceError } = await service
          .from("workspaces")
          .delete()
          .eq("id", workspaceId);
        assertNoError(cleanupWorkspaceError, "delete workspace fixture");
      },
    };
  } catch (setupError) {
    const cleanupErrors: Error[] = [];
    if (projectCreated) {
      const { error } = await service.from("projects").delete().eq("id", projectId);
      if (error) cleanupErrors.push(new Error(`delete partial project fixture: ${error.message}`));
    }
    if (workspaceCreated) {
      const { error } = await service.from("workspaces").delete().eq("id", workspaceId);
      if (error) cleanupErrors.push(new Error(`delete partial workspace fixture: ${error.message}`));
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError([setupError, ...cleanupErrors], "fixture setup and cleanup failed");
    }
    throw setupError;
  }
}

async function readRun(
  fixture: Fixture,
  runId: string
): Promise<{ status: string; wait_reason: DomainRunWaitReason | null }> {
  const { data, error } = await fixture.service
    .from("orchestrator_runs")
    .select("status, wait_reason")
    .eq("id", runId)
    .single();
  assertNoError(error, `read run ${runId}`);
  return data as { status: string; wait_reason: DomainRunWaitReason | null };
}

async function assertRun(
  fixture: Fixture,
  runId: string,
  expected: { status: string; waitReason: DomainRunWaitReason | null }
): Promise<void> {
  const row = await readRun(fixture, runId);
  assert.deepEqual(row, {
    status: expected.status,
    wait_reason: expected.waitReason,
  });
}

integrationTest(
  "finite Visuals and Audio runs enforce and round-trip every semantic wait reason",
  async () => {
    const fixture = await createFixture("finite");
    try {
      for (const domain of ["visuals", "audio"] as const) {
        const runId = fixture.runIds[domain];
        for (const reason of ["media_job", "domain", "approval"] as const) {
          const parked = await updateOrchestratorRun(runId, {
            status: "waiting",
            waitReason: reason,
          });
          assert.equal(parked.status, "waiting");
          assert.equal(parked.waitReason, reason);
          await assertRun(fixture, runId, { status: "waiting", waitReason: reason });

          const claims =
            reason === "media_job"
              ? await Promise.all([
                  claimOrchestratorRunResume(runId),
                  claimOrchestratorRunResume(runId),
                ])
              : [
                  await claimOrchestratorRunResume(runId),
                  await claimOrchestratorRunResume(runId),
                ];
          const winners = claims.filter((claim) => claim !== null);
          const losers = claims.filter((claim) => claim === null);
          assert.equal(winners.length, 1, `${domain} ${reason} wait has one claim winner`);
          assert.equal(losers.length, 1, `${domain} ${reason} wait has one claim loser`);
          const claimed = winners[0];
          assert.ok(claimed, `${domain} ${reason} wait is claimed once`);
          assert.equal(claimed.status, "running");
          assert.equal(claimed.waitReason, undefined);
          await assertRun(fixture, runId, { status: "running", waitReason: null });
        }

        const invalidWaiting = await fixture.service
          .from("orchestrator_runs")
          .update({ status: "waiting", wait_reason: null })
          .eq("id", runId);
        assertWaitReasonConstraint(invalidWaiting.error, `${domain} waiting without a reason`);
        await assertRun(fixture, runId, { status: "running", waitReason: null });

        const invalidRunning = await fixture.service
          .from("orchestrator_runs")
          .update({ status: "running", wait_reason: "media_job" })
          .eq("id", runId);
        assertWaitReasonConstraint(invalidRunning.error, `${domain} running with a reason`);
        await assertRun(fixture, runId, { status: "running", waitReason: null });
      }
    } finally {
      await fixture.cleanup();
    }
  }
);

integrationTest("Creative Director roots retain only null and domain waits", async () => {
  const fixture = await createFixture("root");
  try {
    const nullWait = await fixture.service
      .from("orchestrator_runs")
      .update({ status: "waiting", wait_reason: null })
      .eq("id", fixture.rootRunId);
    assertNoError(nullWait.error, "park root without a reason");
    await assertRun(fixture, fixture.rootRunId, { status: "waiting", waitReason: null });

    const running = await fixture.service
      .from("orchestrator_runs")
      .update({ status: "running", wait_reason: null })
      .eq("id", fixture.rootRunId);
    assertNoError(running.error, "resume root from null wait");

    const domainWait = await fixture.service
      .from("orchestrator_runs")
      .update({ status: "waiting", wait_reason: "domain" })
      .eq("id", fixture.rootRunId);
    assertNoError(domainWait.error, "park root on domain work");
    await assertRun(fixture, fixture.rootRunId, { status: "waiting", waitReason: "domain" });

    const rootClaim = await claimOrchestratorRunResume(fixture.rootRunId);
    assert.ok(rootClaim, "root domain wait is claimed once");
    assert.equal(rootClaim.status, "running");
    assert.equal(rootClaim.waitReason, undefined);
    await assertRun(fixture, fixture.rootRunId, { status: "running", waitReason: null });

    for (const reason of ["media_job", "approval"] as const) {
      const invalidRootWait = await fixture.service
        .from("orchestrator_runs")
        .update({ status: "waiting", wait_reason: reason })
        .eq("id", fixture.rootRunId);
      assertWaitReasonConstraint(invalidRootWait.error, `root ${reason} wait`);
      await assertRun(fixture, fixture.rootRunId, { status: "running", waitReason: null });
    }

    const invalidRunningRoot = await fixture.service
      .from("orchestrator_runs")
      .update({ status: "running", wait_reason: "domain" })
      .eq("id", fixture.rootRunId);
    assertWaitReasonConstraint(invalidRunningRoot.error, "running root with domain reason");
    await assertRun(fixture, fixture.rootRunId, { status: "running", waitReason: null });
  } finally {
    await fixture.cleanup();
  }
});
