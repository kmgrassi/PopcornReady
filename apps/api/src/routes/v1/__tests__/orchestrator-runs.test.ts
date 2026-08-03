import assert from "node:assert/strict";
import test from "node:test";

import type {
  OrchestratorRun,
  OrchestratorRunGate,
  RunActionSummary,
} from "@/lib/api/v1/orchestrator-store";
import { ApiError } from "@/core/errors";
import type { StoryboardEntrypointLock } from "@/lib/postgres/storyboard-entrypoint";
import { SCHEMA, type Job } from "@popcorn/shared/v1/types";
import { projectRunDetailFromParts } from "../orchestrator-run-projections.js";
import {
  initialRunGates,
  initialRunStopAfterTools,
  isStoryboardAfterGate,
  runFailedForInsufficientCredits,
  storyboardContinuationPatch,
  storyboardGenerationEntrypointRoute,
  storyboardGenerationEntrypointStatusRoute,
  stopAfterTools,
  type StoryboardEntrypointDeps,
} from "../orchestrator-runs";


function runFixture(overrides: Partial<OrchestratorRun> = {}): OrchestratorRun {
  return {
    id: "run_1",
    schemaVersion: "orchestrator_run.v1",
    projectId: "project_1",
    status: "succeeded",
    inputSummary: "make a video",
    spentUsd: 0,
    createdAt: "2026-06-15T00:00:00.000Z",
    updatedAt: "2026-06-15T00:00:01.000Z",
    ...overrides,
  };
}

function actionFixture(
  tool: string,
  overrides: Partial<RunActionSummary> = {}
): RunActionSummary {
  return {
    id: `action_${tool}`,
    tool,
    status: "applied",
    params: {},
    outputAssetIds: [],
    jobIds: [],
    createdAt: "2026-06-15T00:00:01.000Z",
    ...overrides,
  };
}

function gateFixture(
  stage: string,
  overrides: Partial<OrchestratorRunGate> = {}
): OrchestratorRunGate {
  return {
    id: `gate_${stage}`,
    orchestratorRunId: "run_1",
    stage,
    status: "reached",
    createdAt: "2026-06-15T00:00:00.000Z",
    updatedAt: "2026-06-15T00:00:03.000Z",
    ...overrides,
  };
}

function jobFixture(status: Job["status"], id = "job_1"): Job {
  return {
    id,
    schemaVersion: SCHEMA.job,
    workspaceId: "workspace_1",
    projectId: "project_1",
    type: "asset_generation",
    status,
    progress: {},
    input: null,
    result: null,
    error: null,
    createdAt: "2026-06-15T00:00:01.000Z",
    updatedAt: "2026-06-15T00:00:02.000Z",
  };
}

test("makes an unexpected terminal success without video a terminal partial failure", () => {
  const payload = projectRunDetailFromParts(
    runFixture(),
    [],
    [
      actionFixture("create_or_load_brief", { outputAssetIds: ["brief_asset"] }),
      actionFixture("plan_shots", { outputAssetIds: ["plan_asset"] }),
      actionFixture("generate_storyboard", { outputAssetIds: ["storyboard_asset"] }),
    ]
  );

  assert.equal(payload.run.status, "failed");
  assert.equal(payload.run.currentStageType, "storyboard");
  assert.equal(payload.run.error?.code, "missing_video_output");
  assert.match(payload.run.message ?? "", /no playable video was created/i);
  assert.equal(payload.resultArtifacts?.length, 0);
});

test("every initial run stops after a complete storyboard", () => {
  assert.deepEqual(stopAfterTools({}), []);
  assert.deepEqual(stopAfterTools({ runThrough: true }), []);
  assert.deepEqual(stopAfterTools({ runThrough: false }), ["generate_storyboard"]);
  assert.deepEqual(stopAfterTools({ stopAfter: "brief_intake" }), ["create_or_load_brief"]);
  assert.deepEqual(stopAfterTools({ runThrough: true, stopAfter: "storyboard" }), [
    "generate_storyboard",
  ]);
  assert.deepEqual(initialRunStopAfterTools({}), ["generate_storyboard"]);
  assert.deepEqual(initialRunStopAfterTools({ runThrough: true }), ["generate_storyboard"]);
  assert.deepEqual(initialRunStopAfterTools({ stopAfter: "brief_intake" }), ["generate_storyboard"]);
  assert.deepEqual(initialRunStopAfterTools({ stopAfter: "creative_plan" }), ["generate_storyboard"]);
  assert.deepEqual(initialRunStopAfterTools({ stopAfter: "asset_generation" }), ["generate_storyboard"]);
  assert.deepEqual(
    initialRunGates({
      reviewGates: ["brief_intake", "creative_plan", "asset_generation"],
      stopAfter: "creative_plan",
    }),
    ["after:generate_storyboard"],
  );
});

test("storyboard entrypoint reuses an active Creative Director root with an unresolved board gate", async () => {
  const existing = runFixture({ status: "waiting" });
  let created = false;
  let enqueued = false;
  const result = await storyboardGenerationEntrypointRoute(
    {
      auth: {
        workspaceId: "workspace_1",
        actor: { id: "actor_1" },
      } as never,
      body: {},
    },
    { projectId: "project_1" },
    {
      requireProjectAccess: async () => undefined,
      listRuns: async () => [existing],
      listGates: async () => [gateFixture("after:generate_storyboard", { status: "pending" })],
      createRun: async () => {
        created = true;
        return { run: existing, replayed: false };
      },
      enqueueRun: async () => {
        enqueued = true;
      },
      withProjectLock: async (_projectId, operation) => operation(),
    }
  );

  assert.deepEqual(result, {
    status: 200,
    body: { runId: "run_1", reused: true },
  });
  assert.equal(created, false);
  assert.equal(enqueued, false);
});

test("storyboard entrypoint retry reuses and re-wakes a queued run after initial dispatch failure", async () => {
  const existing = runFixture({ id: "run_orphaned", status: "queued" });
  const runs: ReturnType<typeof runFixture>[] = [];
  const enqueued: string[] = [];
  let createCount = 0;
  let enqueueAttempts = 0;
  const withProjectLock: StoryboardEntrypointLock = async (_projectId, operation) =>
    operation();
  const deps: Partial<StoryboardEntrypointDeps> = {
    requireProjectAccess: async () => undefined,
    listRuns: async () => runs,
    listGates: async () => [gateFixture("after:generate_storyboard", { status: "pending" })],
    getActiveProjectBrief: async () => ({ assetId: "brief_1" }) as never,
    createRun: async () => {
      createCount += 1;
      runs.push(existing);
      return { run: existing, replayed: false };
    },
    enqueueRun: async (runId: string) => {
      enqueueAttempts += 1;
      if (enqueueAttempts === 1) throw new Error("dispatch unavailable");
      enqueued.push(runId);
    },
    withProjectLock,
  };
  const request = () =>
    storyboardGenerationEntrypointRoute(
      {
        auth: {
          workspaceId: "workspace_1",
          actor: { id: "actor_1" },
        } as never,
        body: {},
      },
      { projectId: "project_1" },
      deps
    );

  await assert.rejects(request(), /dispatch unavailable/);
  const result = await request();

  assert.deepEqual(result, {
    status: 200,
    body: { runId: "run_orphaned", reused: true },
  });
  assert.equal(createCount, 1);
  assert.equal(enqueueAttempts, 2);
  assert.deepEqual(enqueued, ["run_orphaned"]);
});

test("storyboard entrypoint does not wake a queued run whose storyboard gate is reached", async () => {
  const existing = runFixture({ id: "run_at_review", status: "queued" });
  let enqueued = false;
  const result = await storyboardGenerationEntrypointRoute(
    {
      auth: { workspaceId: "workspace_1", actor: { id: "actor_1" } } as never,
      body: {},
    },
    { projectId: "project_1" },
    {
      requireProjectAccess: async () => undefined,
      listRuns: async () => [existing],
      listGates: async () => [gateFixture("after:generate_storyboard", { status: "reached" })],
      enqueueRun: async () => {
        enqueued = true;
      },
      withProjectLock: async (_projectId, operation) => operation(),
    }
  );

  assert.deepEqual(result.body, { runId: "run_at_review", reused: true });
  assert.equal(enqueued, false);
});

test("storyboard status returns only the latest server-projected boundary run", async () => {
  let requestedStage = "";
  const result = await storyboardGenerationEntrypointStatusRoute(
    {
      auth: { workspaceId: "workspace_1" } as never,
    },
    { projectId: "project_1" },
    {
      requireProjectAccess: async () => undefined,
      getLatestRunForGate: async (_projectId, stage) => {
        requestedStage = stage;
        return {
          run: runFixture({ status: "running" }),
          gate: gateFixture("after:generate_storyboard", { status: "pending" }),
        };
      },
    }
  );

  assert.equal(requestedStage, "after:generate_storyboard");
  assert.equal(result.body.run?.runId, "run_1");
  assert.equal(result.body.run?.storyboardBoundaryStatus, "pending");
  assert.equal(result.body.run?.status, "running");
});

test("storyboard entrypoint creates a storyboard-bounded run from the active brief without poster work", async () => {
  const created = runFixture({ id: "run_storyboard", status: "queued" });
  let createdInput: Record<string, unknown> | undefined;
  const enqueued: string[] = [];
  const result = await storyboardGenerationEntrypointRoute(
    {
      auth: {
        workspaceId: "workspace_1",
        actor: { id: "actor_1", isAnonymous: false },
      } as never,
      body: {},
      req: { header: () => "storyboard-request-1" } as never,
    },
    { projectId: "project_1" },
    {
      requireProjectAccess: async () => undefined,
      listRuns: async () => [runFixture({ status: "canceled" })],
      listGates: async () => [],
      getActiveProjectBrief: async () => ({ assetId: "brief_1" }) as never,
      createRun: async (input) => {
        createdInput = input as unknown as Record<string, unknown>;
        return { run: created, replayed: false };
      },
      enqueueRun: async (runId) => {
        enqueued.push(runId);
      },
      withProjectLock: async (_projectId, operation) => operation(),
    }
  );

  assert.equal(result.status, 202);
  assert.deepEqual(result.body, { runId: "run_storyboard", reused: false });
  assert.deepEqual(createdInput?.gates, ["after:generate_storyboard"]);
  assert.equal(createdInput?.entrypoint, "storyboard");
  assert.equal(createdInput?.idempotencyKey, "storyboard-request-1");
  assert.match(String(createdInput?.inputSummary), /scene-and-moment planning/i);
  assert.deepEqual(enqueued, ["run_storyboard"]);
});

test("storyboard entrypoint does not reuse a resolved board gate and requires an active brief", async () => {
  await assert.rejects(
    storyboardGenerationEntrypointRoute(
      {
        auth: {
          workspaceId: "workspace_1",
          actor: { id: "actor_1" },
        } as never,
        body: {},
      },
      { projectId: "project_1" },
      {
        requireProjectAccess: async () => undefined,
        listRuns: async () => [runFixture({ status: "running" })],
        listGates: async () => [
          gateFixture("after:generate_storyboard", { status: "approved" }),
        ],
        getActiveProjectBrief: async () => null,
        withProjectLock: async (_projectId, operation) => operation(),
      }
    ),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "brief_missing");
      assert.match(error.message, /finish the project brief/i);
      return true;
    }
  );
});

test("storyboard entrypoint re-wakes a queued idempotent replay", async () => {
  const replayed = runFixture({ id: "run_replayed", status: "queued" });
  const enqueued: string[] = [];
  const result = await storyboardGenerationEntrypointRoute(
    {
      auth: { workspaceId: "workspace_1", actor: { id: "actor_1" } } as never,
      body: {},
      req: { header: () => "storyboard-replay" } as never,
    },
    { projectId: "project_1" },
    {
      requireProjectAccess: async () => undefined,
      listRuns: async () => [],
      listGates: async () => [],
      getActiveProjectBrief: async () => ({ assetId: "brief_1" }) as never,
      createRun: async () => ({ run: replayed, replayed: true }),
      enqueueRun: async (runId) => {
        enqueued.push(runId);
      },
      withProjectLock: async (_projectId, operation) => operation(),
    }
  );

  assert.deepEqual(result, {
    status: 200,
    body: { runId: "run_replayed", reused: true },
  });
  assert.deepEqual(enqueued, ["run_replayed"]);
});

test("storyboard entrypoint does not re-wake a completed idempotent replay", async () => {
  const replayed = runFixture({ id: "run_completed", status: "succeeded" });
  let enqueued = false;
  const result = await storyboardGenerationEntrypointRoute(
    {
      auth: { workspaceId: "workspace_1", actor: { id: "actor_1" } } as never,
      body: {},
      req: { header: () => "storyboard-completed-replay" } as never,
    },
    { projectId: "project_1" },
    {
      requireProjectAccess: async () => undefined,
      listRuns: async () => [],
      listGates: async () => [],
      getActiveProjectBrief: async () => ({ assetId: "brief_1" }) as never,
      createRun: async () => ({ run: replayed, replayed: true }),
      enqueueRun: async () => {
        enqueued = true;
      },
      withProjectLock: async (_projectId, operation) => operation(),
    }
  );

  assert.deepEqual(result, {
    status: 200,
    body: { runId: "run_completed", reused: true },
  });
  assert.equal(enqueued, false);
});

test("storyboard entrypoint serializes concurrent find-or-create requests per project", async () => {
  const created = runFixture({ id: "run_serialized", status: "queued" });
  const runs: ReturnType<typeof runFixture>[] = [];
  let createCount = 0;
  const enqueued: string[] = [];
  let lockTail = Promise.resolve();
  const withProjectLock: StoryboardEntrypointLock = async (_projectId, operation) => {
    const previous = lockTail;
    let release: () => void = () => undefined;
    lockTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };
  const deps = {
    requireProjectAccess: async () => undefined,
    listRuns: async () => runs,
    listGates: async (runId: string) =>
      runId === created.id
        ? [gateFixture("after:generate_storyboard", { status: "pending" })]
        : [],
    getActiveProjectBrief: async () => ({ assetId: "brief_1" }) as never,
    createRun: async () => {
      createCount += 1;
      runs.unshift(created);
      return { run: created, replayed: false };
    },
    enqueueRun: async (runId: string) => {
      enqueued.push(runId);
    },
    withProjectLock,
  };

  const [first, second] = await Promise.all(
    ["request-a", "request-b"].map((key) =>
      storyboardGenerationEntrypointRoute(
        {
          auth: { workspaceId: "workspace_1", actor: { id: "actor_1" } } as never,
          body: {},
          req: { header: () => key } as never,
        },
        { projectId: "project_1" },
        deps
      )
    )
  );

  assert.equal(createCount, 1);
  assert.deepEqual(enqueued, ["run_serialized", "run_serialized"]);
  assert.deepEqual(
    [first.body.reused, second.body.reused].sort(),
    [false, true]
  );
});

test("continuing a reviewed storyboard reopens its completed run", () => {
  const run = runFixture({
    startedAt: "2026-06-15T00:00:01.000Z",
    completedAt: "2026-06-15T00:00:02.000Z",
    error: { message: "Previous error" },
  });
  assert.deepEqual(storyboardContinuationPatch(run), {
    status: "waiting",
    startedAt: "2026-06-15T00:00:01.000Z",
    clearCompletedAt: true,
    clearError: true,
  });
});

test("identifies only the completed storyboard after-gate for run reopening", () => {
  assert.equal(isStoryboardAfterGate(gateFixture("after:generate_storyboard")), true);
  assert.equal(isStoryboardAfterGate(gateFixture("generate_storyboard")), false);
  assert.equal(isStoryboardAfterGate(gateFixture("after:generate_keyframe")), false);
});

test("surfaces orchestrator success as ready once export_video produced output", () => {
  const payload = projectRunDetailFromParts(
    runFixture(),
    [],
    [
      actionFixture("assemble_timeline", { outputAssetIds: ["timeline_1"] }),
      actionFixture("export_video", { outputAssetIds: ["export_asset_1"] }),
    ],
    new Map([
      ["export_asset_1", { status: "ready", kind: "video", hasPlayableSource: true }],
    ])
  );

  assert.equal(payload.run.status, "succeeded");
  assert.equal(payload.run.completionKind, "video");
  assert.equal(payload.run.currentStageType, "ready");
  assert.deepEqual(payload.resultArtifacts, [
    {
      kind: "export",
      purpose: "export",
      artifactId: "export_asset_1",
      assetId: "export_asset_1",
      stageId: "run_1:export",
    },
  ]);
});

test("projects a creator-direct image as one successful standalone asset step", () => {
  const payload = projectRunDetailFromParts(
    runFixture({
      agentRole: "visuals",
      originKind: "creator_direct",
      taskKind: "image_create",
    }),
    [],
    [
      actionFixture("creator_direct_proposal"),
      actionFixture("generate_image_asset", { outputAssetIds: ["image_1"] }),
      actionFixture("store_asset_bytes", { outputAssetIds: ["image_1"] }),
      actionFixture("domain_report"),
    ],
    new Map([["image_1", { status: "ready", kind: "image" }]])
  );

  assert.equal(payload.run.status, "succeeded");
  assert.equal(payload.run.completionKind, "standalone_asset");
  assert.equal(payload.run.presentationKind, "standalone_image");
  assert.match(payload.run.message ?? "", /asset is ready/i);
  assert.deepEqual(payload.stages.map((stage) => ({
    tool: stage.toolName,
    type: stage.type,
    status: stage.status,
  })), [{ tool: "generate_image_asset", type: "asset_generation", status: "succeeded" }]);
  assert.deepEqual(payload.stageItems.map((item) => ({
    kind: item.kind,
    purpose: item.purpose,
    assetId: item.assetId,
  })), [{ kind: "image", purpose: "asset", assetId: "image_1" }]);
});

test("projects legacy poster work as an asset and hides unknown tools", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ status: "canceled" }),
    [gateFixture("after:generate_storyboard", { status: "pending" })],
    [
      actionFixture("generate_poster", { outputAssetIds: ["poster_1"] }),
      actionFixture("unknown_legacy_tool", { outputAssetIds: ["unknown_1"] }),
    ]
  );

  assert.equal(payload.run.storyboardBoundaryStatus, "pending");
  assert.deepEqual(
    payload.stages.map((stage) => ({ tool: stage.toolName, type: stage.type })),
    [{ tool: "generate_poster", type: "asset_generation" }]
  );
  assert.deepEqual(
    payload.stageItems.map((item) => ({ assetId: item.assetId, purpose: item.purpose })),
    [{ assetId: "poster_1", purpose: "asset" }]
  );
});

test("keeps unknown tool jobs in operator diagnostics without creating creator stages", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ status: "failed" }),
    [],
    [actionFixture("unknown_legacy_tool", { status: "failed", jobIds: ["job_unknown"] })],
    new Map(),
    {
      includeOperatorDiagnostics: true,
      jobs: new Map([["job_unknown", jobFixture("failed", "job_unknown")]]),
    }
  );

  assert.deepEqual(payload.stages, []);
  assert.deepEqual(
    payload.operatorDiagnostics?.map((diagnostic) => diagnostic.jobId),
    ["job_unknown"]
  );
});

test("fails a completed standalone run that has no ready asset", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ originKind: "creator_direct", taskKind: "image_create" }),
    [],
    [actionFixture("generate_image_asset", { outputAssetIds: ["image_1"] })],
    new Map([["image_1", { status: "pending", kind: "image" }]])
  );

  assert.equal(payload.run.status, "failed");
  assert.equal(payload.run.error?.code, "missing_asset_output");
});

test("terminal parent state prevents stale tool actions from appearing active", () => {
  for (const status of ["failed", "canceled"] as const) {
    const payload = projectRunDetailFromParts(
      runFixture({
        status,
        originKind: "creator_direct",
        taskKind: "image_create",
      }),
      [],
      [actionFixture("generate_image_asset", { status: "running", jobIds: ["job_1"] })],
      new Map(),
      { jobs: new Map([["job_1", jobFixture("canceled")]]) }
    );

    assert.equal(payload.run.currentToolName, undefined);
    assert.equal(payload.stages[0]?.status, "canceled");
    assert.notEqual(payload.stages[0]?.status, "running");
  }
});

test("latest retry jobs control stage status while earlier attempts remain visible", () => {
  for (const latestJobStatus of ["running", "succeeded"] as const) {
    const payload = projectRunDetailFromParts(
      runFixture({ status: "running" }),
      [],
      [
        actionFixture("generate_image_asset", {
          id: "attempt_old",
          status: "failed",
          jobIds: ["job_old"],
          createdAt: "2026-06-15T00:00:01.000Z",
        }),
        actionFixture("generate_image_asset", {
          id: "attempt_new",
          status: "running",
          jobIds: ["job_new"],
          createdAt: "2026-06-15T00:00:02.000Z",
        }),
      ],
      new Map(),
      {
        jobs: new Map([
          ["job_old", jobFixture("failed", "job_old")],
          ["job_new", jobFixture(latestJobStatus, "job_new")],
        ]),
      }
    );

    assert.equal(payload.stages[0]?.status, latestJobStatus);
    assert.deepEqual(payload.stages[0]?.jobIds, ["job_old", "job_new"]);
    assert.deepEqual(
      payload.stages[0]?.jobActivities?.map((activity) => activity.status),
      ["failed", latestJobStatus]
    );
  }
});

test("playable export wins over an after-export stop gate", () => {
  const payload = projectRunDetailFromParts(
    runFixture(),
    [gateFixture("after:export_video")],
    [actionFixture("export_video", { outputAssetIds: ["export_asset_1"] })],
    new Map([
      ["export_asset_1", { status: "ready", kind: "video", hasPlayableSource: true }],
    ])
  );

  assert.equal(payload.run.status, "succeeded");
  assert.equal(payload.run.completionKind, "video");
  assert.match(payload.run.message ?? "", /video export is ready/i);
});

test("rejects applied exports whose output is missing or not playable", () => {
  for (const asset of [
    undefined,
    { status: "pending", kind: "video", hasPlayableSource: true },
    { status: "ready", kind: "image", hasPlayableSource: true },
    { status: "ready", kind: "video", hasPlayableSource: false },
  ]) {
    const assets = asset ? new Map([["export_asset_1", asset]]) : new Map();
    const payload = projectRunDetailFromParts(
      runFixture(),
      [],
      [actionFixture("export_video", { outputAssetIds: ["export_asset_1"] })],
      assets
    );
    assert.equal(payload.run.status, "failed");
    assert.equal(payload.run.error?.code, "missing_video_output");
  }
});

test("active work has unknown progress and reports provider waits and recovery", () => {
  const waiting = projectRunDetailFromParts(
    runFixture({ status: "waiting", agentRole: "visuals", waitReason: "media_job" }),
    [],
    [actionFixture("generate_anchor", { status: "running" })]
  );
  assert.equal(waiting.run.progressPercent, undefined);
  assert.equal(waiting.run.activityState, "waiting_on_job");
  assert.equal(waiting.run.currentToolName, "generate_anchor");

  const historicalRootWait = projectRunDetailFromParts(
    runFixture({ status: "waiting" }),
    [],
    [actionFixture("generate_anchor", { status: "running", jobIds: ["job_1"] })]
  );
  assert.equal(historicalRootWait.run.activityState, "waiting_on_job");

  const recovering = projectRunDetailFromParts(
    runFixture({ status: "running" }),
    [],
    [
      actionFixture("generate_clip", {
        status: "failed",
        error: { recoverable: true },
        createdAt: "2026-06-15T00:00:01.000Z",
      }),
      actionFixture("generate_storyboard", {
        status: "running",
        createdAt: "2026-06-15T00:00:02.000Z",
      }),
    ]
  );
  assert.equal(recovering.run.activityState, "recovering");
  assert.equal(recovering.run.currentToolName, "generate_storyboard");
  assert.equal(recovering.stages.find((stage) => stage.toolName === "generate_clip")?.status, "failed");

  const recovered = projectRunDetailFromParts(
    runFixture({ status: "running" }),
    [],
    [
      actionFixture("generate_clip", {
        id: "clip_failed",
        status: "failed",
        error: { recoverable: true },
        createdAt: "2026-06-15T00:00:01.000Z",
      }),
      actionFixture("generate_clip", {
        id: "clip_recovered",
        status: "applied",
        createdAt: "2026-06-15T00:00:02.000Z",
      }),
      actionFixture("export_video", {
        status: "running",
        createdAt: "2026-06-15T00:00:03.000Z",
      }),
    ]
  );
  assert.equal(recovered.run.activityState, "working");
});

test("projects a storyboard stop as an actionable review state", () => {
  const payload = projectRunDetailFromParts(
    runFixture(),
    [gateFixture("after:generate_storyboard")],
    [
      actionFixture("create_or_load_brief", { outputAssetIds: ["brief_asset"] }),
      actionFixture("draft_script", { outputAssetIds: ["script_asset"] }),
      actionFixture("generate_storyboard", { outputAssetIds: ["storyboard_asset"] }),
    ]
  );

  assert.equal(payload.run.status, "succeeded");
  assert.equal(payload.run.completionKind, "storyboard_assets");
  assert.deepEqual(payload.run.reviewGate, {
    stageType: "storyboard",
    stageId: "run_1:tool:generate_storyboard",
    state: "awaiting_review",
    enteredAt: "2026-06-15T00:00:03.000Z",
  });
  assert.deepEqual(payload.run.reviewGates, []);
  assert.equal(payload.run.currentStageType, "storyboard");
  assert.equal(
    payload.stages.find((stage) => stage.type === "storyboard")?.stageId,
    payload.run.reviewGate?.stageId
  );
  assert.match(payload.run.message ?? "", /storyboard assets are ready/i);
});

test("does not claim storyboard assets for an intentional early stop", () => {
  const payload = projectRunDetailFromParts(
    runFixture(),
    [gateFixture("after:create_or_load_brief")],
    [actionFixture("create_or_load_brief", { outputAssetIds: ["brief_asset"] })]
  );

  assert.equal(payload.run.status, "succeeded");
  assert.equal(payload.run.completionKind, undefined);
  assert.match(payload.run.message ?? "", /no playable video/i);
  assert.doesNotMatch(payload.run.message ?? "", /storyboard/i);
});

test("keeps board feedback actions out of generation progress projections", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ status: "running" }),
    [],
    [
      actionFixture("generate_storyboard", { outputAssetIds: ["storyboard_asset"] }),
      actionFixture("board_feedback", {
        id: "feedback_1",
        status: "proposed",
        params: {
          message: "Make this frame moodier.",
          target: { scope: "tile", beatId: "beat_1", assetId: "storyboard_asset" },
        },
        createdAt: "2026-06-15T00:00:02.000Z",
      }),
    ]
  );

  assert.equal(payload.run.currentStageType, "storyboard");
  assert.deepEqual(
    payload.stages.map((stage) => stage.type),
    ["storyboard"]
  );
  assert.deepEqual(
    payload.stageItems.map((item) => item.assetId),
    ["storyboard_asset"]
  );
});

test("projects a regenerated stage from the latest action instead of stale failures", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ status: "waiting" }),
    [
      {
        id: "gate_1",
        orchestratorRunId: "run_1",
        stage: "create_or_load_brief",
        status: "reached",
        createdAt: "2026-06-15T00:00:00.000Z",
        updatedAt: "2026-06-15T00:00:03.000Z",
      },
    ],
    [
      actionFixture("create_or_load_brief", {
        id: "failed_brief",
        status: "failed",
        error: { kind: "invalid_input", message: "The request body is invalid.", recoverable: true },
        createdAt: "2026-06-15T00:00:01.000Z",
      }),
      actionFixture("create_or_load_brief", {
        id: "applied_brief",
        status: "applied",
        outputAssetIds: ["brief_asset_2"],
        createdAt: "2026-06-15T00:00:02.000Z",
      }),
    ]
  );

  assert.equal(payload.run.status, "running");
  assert.equal(payload.run.reviewGate?.stageType, "brief_intake");
  assert.equal(payload.stages[0]?.status, "succeeded");
  assert.equal(payload.stages[0]?.error, undefined);
  assert.deepEqual(payload.stages[0]?.artifactIds, ["brief_asset_2"]);
});

test("projects a reached dynamic approval gate as a resolvable review gate", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ status: "waiting" }),
    [
      {
        id: "gate_export_video",
        orchestratorRunId: "run_1",
        stage: "export_video",
        status: "reached",
        createdAt: "2026-06-15T00:00:00.000Z",
        updatedAt: "2026-06-15T00:00:03.000Z",
      },
    ],
    [actionFixture("request_approval", { status: "running", outputAssetIds: ["preview_1"] })]
  );

  assert.equal(payload.run.reviewGate?.stageType, "export");
  assert.equal(payload.run.reviewGate?.state, "awaiting_review");
  assert.equal(payload.run.currentStageType, "export");
  const qualityStage = payload.stages.find((stage) => stage.type === "quality_review");
  assert.deepEqual(qualityStage?.artifactIds, ["preview_1"]);
});

test("keeps sibling tool statuses separate within a broad stage", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ status: "running" }),
    [],
    [
      actionFixture("generate_keyframe", {
        id: "failed_keyframe",
        status: "failed",
        error: {
          kind: "invalid_input",
          message: "Missing beat id.",
          recoverable: true,
        },
        createdAt: "2026-06-15T00:00:01.000Z",
      }),
      actionFixture("generate_clip", {
        id: "applied_clip",
        status: "applied",
        outputAssetIds: ["clip_asset_1"],
        createdAt: "2026-06-15T00:00:02.000Z",
      }),
    ]
  );

  const keyframeStage = payload.stages.find(
    (candidate) => candidate.toolName === "generate_keyframe"
  );
  const clipStage = payload.stages.find((candidate) => candidate.toolName === "generate_clip");
  assert.equal(keyframeStage?.status, "failed");
  assert.equal(keyframeStage?.error?.message, "Missing beat id.");
  assert.deepEqual(keyframeStage?.artifactIds, []);
  assert.equal(clipStage?.status, "succeeded");
  assert.deepEqual(clipStage?.artifactIds, ["clip_asset_1"]);
});

test("projects stage item purpose metadata from orchestrator tools", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ status: "running" }),
    [],
    [
      actionFixture("generate_storyboard", {
        id: "storyboard_action",
        outputAssetIds: ["storyboard_asset_1"],
      }),
      actionFixture("generate_keyframe", {
        id: "keyframe_action",
        outputAssetIds: ["keyframe_asset_1"],
      }),
      actionFixture("generate_clip", {
        id: "clip_action",
        outputAssetIds: ["clip_asset_1"],
      }),
      actionFixture("generate_audio", {
        id: "audio_action",
        outputAssetIds: ["audio_asset_1"],
      }),
      actionFixture("fit_audio_to_picture", {
        id: "audio_fit_action",
        outputAssetIds: ["audio_fit_critique_1"],
      }),
      actionFixture("assemble_timeline", {
        id: "timeline_action",
        outputAssetIds: ["timeline_asset_1"],
      }),
    ]
  );

  assert.deepEqual(
    payload.stageItems.map((item) => ({
      kind: item.kind,
      purpose: item.purpose,
      assetId: item.assetId,
    })),
    [
      { kind: "image", purpose: "storyboard_frame", assetId: "storyboard_asset_1" },
      { kind: "image", purpose: "keyframe", assetId: "keyframe_asset_1" },
      { kind: "video", purpose: "shot", assetId: "clip_asset_1" },
      { kind: "audio", purpose: "audio", assetId: "audio_asset_1" },
      { kind: "audio", purpose: "audio", assetId: "audio_fit_critique_1" },
      { kind: "timeline", purpose: "timeline", assetId: "timeline_asset_1" },
    ]
  );
});

test("projects audio fit actions into the audio generation stage", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ status: "running" }),
    [],
    [
      actionFixture("fit_audio_to_picture", {
        id: "audio_fit_action",
        outputAssetIds: ["audio_fit_critique_1"],
      }),
    ]
  );

  const audioStage = payload.stages.find(
    (candidate) => candidate.toolName === "fit_audio_to_picture"
  );
  assert.equal(audioStage?.type, "audio_generation");
  assert.deepEqual(audioStage?.artifactIds, ["audio_fit_critique_1"]);
});

test("projects video edit actions as video asset-generation stage items", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ status: "waiting" }),
    [],
    [
      actionFixture("edit_video_asset", {
        id: "edit_action",
        status: "running",
        params: { prompt: "Add a dinosaur sitting on the couch." },
        outputAssetIds: ["edited_clip_asset"],
        jobIds: ["job_edit_1"],
      }),
    ]
  );

  assert.deepEqual(
    payload.stages.map((stage) => ({
      type: stage.type,
      label: stage.label,
      status: stage.status,
      artifactIds: stage.artifactIds,
      jobIds: stage.jobIds,
    })),
    [
      {
        type: "asset_generation",
        label: "Video Edits",
        status: "running",
        artifactIds: ["edited_clip_asset"],
        jobIds: ["job_edit_1"],
      },
    ]
  );
  assert.deepEqual(
    payload.stageItems.map((item) => ({
      kind: item.kind,
      purpose: item.purpose,
      promptPreview: item.promptPreview,
      assetId: item.assetId,
    })),
    [
      {
        kind: "video",
        purpose: "shot",
        promptPreview: "Add a dinosaur sitting on the couch.",
        assetId: "edited_clip_asset",
      },
    ]
  );
});

test("projects data-only tool outputs as non-visual stage items", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ status: "running" }),
    [],
    [
      actionFixture("create_or_load_brief", { outputAssetIds: ["brief_asset"] }),
      actionFixture("develop_story_blueprint", { outputAssetIds: ["blueprint_asset"] }),
      actionFixture("draft_script", { outputAssetIds: ["script_asset"] }),
      actionFixture("plan_shots", { outputAssetIds: ["plan_asset"] }),
      actionFixture("plan_visual_anchors", { outputAssetIds: ["anchor_plan_asset"] }),
    ]
  );

  assert.deepEqual(
    payload.stageItems.map((item) => ({
      kind: item.kind,
      purpose: item.purpose,
      assetId: item.assetId,
    })),
    [
      { kind: "caption", purpose: "brief", assetId: "brief_asset" },
      { kind: "caption", purpose: "plan", assetId: "blueprint_asset" },
      { kind: "caption", purpose: "plan", assetId: "script_asset" },
      { kind: "caption", purpose: "plan", assetId: "plan_asset" },
      { kind: "caption", purpose: "plan", assetId: "anchor_plan_asset" },
    ]
  );
});

test("keeps request approval preview artifacts visible", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ status: "waiting" }),
    [gateFixture("request_approval")],
    [
      actionFixture("request_approval", {
        id: "approval_action",
        status: "running",
        outputAssetIds: ["preview_asset_1"],
      }),
    ]
  );

  assert.deepEqual(
    payload.stageItems.map((item) => ({
      kind: item.kind,
      purpose: item.purpose,
      assetId: item.assetId,
    })),
    [{ kind: "image", purpose: "quality_review", assetId: "preview_asset_1" }]
  );
});

test("projects full action prompts into stage items", () => {
  const longPrompt = `${"cinematic ".repeat(40)}final frame`;
  const payload = projectRunDetailFromParts(
    runFixture({ status: "running" }),
    [],
    [
      actionFixture("generate_keyframe", {
        params: { prompt: longPrompt },
        outputAssetIds: ["keyframe_asset_1"],
      }),
    ]
  );

  assert.equal(payload.stageItems[0]?.prompt, longPrompt);
  assert.ok(payload.stageItems[0]?.promptPreview);
  assert.notEqual(payload.stageItems[0]?.promptPreview, longPrompt);
  assert.match(payload.stageItems[0]?.promptPreview ?? "", /…$/);
});

test("credit recovery accepts run-level insufficient-credit failures without a failed action", () => {
  assert.equal(
    runFailedForInsufficientCredits(
      runFixture({
        status: "failed",
        error: { kind: "insufficient_credits", message: "Ran out of credits mid-run." },
      })
    ),
    true
  );
  assert.equal(
    runFailedForInsufficientCredits(
      runFixture({
        status: "failed",
        error: { kind: "provider_failed", message: "Provider quota failure." },
      })
    ),
    false
  );
  assert.equal(
    runFailedForInsufficientCredits(
      runFixture({
        status: "running",
        error: { kind: "insufficient_credits", message: "Still running." },
      })
    ),
    false
  );
});

test("backfills stage item prompts from linked asset metadata", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ status: "running" }),
    [],
    [
      actionFixture("generate_anchor", {
        outputAssetIds: ["anchor_with_prompt", "anchor_with_description"],
      }),
    ],
    new Map([
      ["anchor_with_prompt", { prompt: "A reusable neon bakery exterior at midnight." }],
      [
        "anchor_with_description",
        { description: "A close character reference for the midnight baker." },
      ],
    ])
  );

  assert.deepEqual(
    payload.stageItems.map((item) => item.prompt),
    [
      "A reusable neon bakery exterior at midnight.",
      "A close character reference for the midnight baker.",
    ]
  );
});

test("keeps an explicit action prompt ahead of linked asset metadata", () => {
  const payload = projectRunDetailFromParts(
    runFixture({ status: "running" }),
    [],
    [
      actionFixture("generate_keyframe", {
        params: { prompt: "The prompt submitted for this action." },
        outputAssetIds: ["keyframe_asset"],
      }),
    ],
    new Map([
      ["keyframe_asset", { prompt: "A different persisted provider prompt." }],
    ])
  );

  assert.equal(payload.stageItems[0]?.prompt, "The prompt submitted for this action.");
});
