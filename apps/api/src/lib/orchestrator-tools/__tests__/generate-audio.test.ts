import assert from "node:assert/strict";
import test from "node:test";

import type { AuthContext } from "@/lib/api/v1/auth";
import type { ShotPlan } from "@popcorn/shared/types";
import { createGenerateAudioTool } from "../generate-audio";
import { runGenerateAudioJob } from "../generate-audio-job";
import { ToolInputError } from "../types";
import type { ToolCallResult } from "../types";

const auth: AuthContext = {
  mode: "local",
  actor: { id: "local_dev", type: "local" },
  workspaceId: "ws_1",
  isLocal: true,
};

const plan: ShotPlan = {
  targetLengthSec: 12,
  style: "warm documentary",
  aspectRatio: "16:9",
  scenes: [
    {
      id: "scene_1",
      name: "Cafe opening",
      beats: [
        { id: "beat_1", name: "Hook", durationSec: 5, intent: "Maya opens the cafe." },
        { id: "beat_2", name: "Payoff", durationSec: 7, intent: "Regulars gather." },
      ],
    },
  ],
};

const activePlan = {
  plan,
  assetId: "plan_1",
  contentHash: "plan_hash",
};

function queuedJob() {
  return {
    job: {
      id: "job_1",
      type: "asset_generation" as const,
      status: "queued" as const,
      projectId: "proj_1",
      createdAt: "t",
      updatedAt: "t",
    },
    created: true,
  };
}

function jobsSpy() {
  const calls: string[] = [];
  let succeededResult: unknown;
  return {
    calls,
    get succeededResult() {
      return succeededResult;
    },
    jobs: {
      async setStep() {
        calls.push("setStep");
        return {} as never;
      },
      async succeed(_id: string, result: unknown) {
        calls.push("succeed");
        succeededResult = result;
        return {} as never;
      },
      async fail() {
        calls.push("fail");
        return {} as never;
      },
    },
  };
}

test("generate_audio requires a plan", async () => {
  const tool = createGenerateAudioTool({
    getActiveProjectPlan: async () => null,
    getActiveProjectBrief: async () => null,
    createJob: async () => {
      throw new Error("must not create a job without a plan");
    },
    runGenerateAudioJob: async () => {},
  });

  const result = (await tool.execute({}, { auth, projectId: "proj_1" })) as ToolCallResult;
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.error.kind, "precondition_unmet");
    assert.equal(result.error.unmetRequirements?.[0]?.satisfyWith.tool, "plan_shots");
  }
});

test("generate_audio accepts and kicks off the worker with active plan and brief", async () => {
  let kicked:
    | {
        jobId: string;
        orchestratorRunId?: string;
        planAssetId?: string;
        provider?: string;
        voiceId?: string;
        briefAssetId?: string;
        sessionClaimGeneration?: number;
      }
    | undefined;
  let durableJobClaimGeneration: number | undefined;
  let durableExecutionClaimGeneration: number | undefined;
  const tool = createGenerateAudioTool({
    getActiveProjectPlan: async () => activePlan,
    getActiveProjectBrief: async () => ({
      brief: {
        goal: "A cafe launch",
        targetLengthSec: 12,
        aspectRatio: "16:9",
        narration: { mode: "provided_text", script: "Welcome to the morning rush." },
      },
      assetId: "brief_1",
      contentHash: "brief_hash",
    }),
    createJob: async (input) => {
      durableJobClaimGeneration = input.sessionClaimGeneration;
      durableExecutionClaimGeneration = (
        input.execution?.input as { sessionClaimGeneration?: number } | undefined
      )?.sessionClaimGeneration;
      return queuedJob();
    },
    runGenerateAudioJob: async (input) => {
      kicked = input;
    },
  });

  const result = (await tool.execute(
    { provider: "mock", voiceId: "voice_1" },
    {
      auth,
      projectId: "proj_1",
      orchestratorRunId: "run_1",
      sessionClaimGeneration: 7,
    }
  )) as ToolCallResult;

  assert.equal(result.status, "accepted");
  if (result.status === "accepted") {
    assert.equal(result.jobId, "job_1");
    assert.equal(result.resumesWhen, "job_terminal");
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(kicked?.jobId, "job_1");
  assert.equal(kicked?.orchestratorRunId, "run_1");
  assert.equal(kicked?.planAssetId, "plan_1");
  assert.equal(kicked?.briefAssetId, "brief_1");
  assert.equal(kicked?.provider, "mock");
  assert.equal(kicked?.voiceId, "voice_1");
  assert.equal(kicked?.sessionClaimGeneration, 7);
  assert.equal(durableJobClaimGeneration, 7);
  assert.equal(durableExecutionClaimGeneration, 7);
});

test("generate_audio omits provider so workspace settings can resolve it", async () => {
  let kicked: { provider?: string } | undefined;
  const tool = createGenerateAudioTool({
    getActiveProjectPlan: async () => activePlan,
    getActiveProjectBrief: async () => null,
    createJob: async () => queuedJob(),
    runGenerateAudioJob: async (input) => {
      kicked = input;
    },
  });

  const result = (await tool.execute(
    {},
    { auth, projectId: "proj_1", orchestratorRunId: "run_1" }
  )) as ToolCallResult;

  assert.equal(result.status, "accepted");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(kicked?.provider, undefined);
});

test("generate_audio validates input before reading the plan", async () => {
  let planReads = 0;
  const tool = createGenerateAudioTool({
    getActiveProjectPlan: async () => {
      planReads += 1;
      return activePlan;
    },
    getActiveProjectBrief: async () => null,
    createJob: async () => queuedJob(),
    runGenerateAudioJob: async () => {},
  });

  assert.throws(() => tool.parseInput({ provider: "banana" }), ToolInputError);
  assert.equal(planReads, 0);
});

test("runGenerateAudioJob generates missing voiceover and soundtrack with graph and claim metadata, then resumes", async () => {
  const spy = jobsSpy();
  const created: Array<{
    role?: string;
    mode?: string;
    prompt?: string;
    graphInputs?: unknown[];
    sessionClaimGeneration?: number;
  }> = [];
  const selected: Array<{ assetId: string; role: string; slotKey: string }> = [];
  let assetCounter = 0;
  let resumedRun: string | undefined;

  await runGenerateAudioJob(
    {
      jobId: "job_1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      orchestratorRunId: "run_1",
      sessionClaimGeneration: 7,
      plan,
      planAssetId: "plan_1",
      planContentHash: "plan_hash",
      brief: {
        goal: "A cafe launch",
        targetLengthSec: 12,
        aspectRatio: "16:9",
        narration: { mode: "provided_text", script: "Welcome to the morning rush." },
      },
      briefAssetId: "brief_1",
      briefContentHash: "brief_hash",
      provider: "mock",
      voiceId: "voice_1",
    },
    {
      jobs: spy.jobs,
      getActiveProjectScopedAsset: async () => null,
      createGeneratedAsset: async (args) => {
        created.push({
          role: (args.body as { assetRole?: string }).assetRole,
          mode: (args.body as { audioMode?: string }).audioMode,
          prompt: (args.body as { prompt?: string }).prompt,
          graphInputs: (args.body as { graphInputs?: unknown[] }).graphInputs,
          sessionClaimGeneration: args.sessionClaimGeneration,
        });
        assetCounter += 1;
        return {
          status: 202,
          body: { job: { result: { assetIds: [`audio_${assetCounter}`] } } },
        };
      },
      selectGeneratedAudioAsset: async (input) => {
        selected.push({
          assetId: input.assetId,
          role: input.role,
          slotKey: input.slotKey,
        });
        return {} as never;
      },
      enqueueOrchestratorDispatch: async (runId) => {
        resumedRun = runId;
      },
    }
  );

  assert.deepEqual(
    created.map((call) => [call.role, call.mode]),
    [
      ["voiceover", "speech"],
      ["voiceover", "speech"],
      ["soundtrack", "music"],
    ]
  );
  assert.equal(
    created.some((call) => call.mode === "speech" && call.prompt?.includes("Overall narration")),
    false
  );
  assert.equal(
    created.some(
      (call) => call.mode === "speech" && call.prompt?.includes("Welcome to the morning rush.")
    ),
    false
  );
  assert.ok(
    created.every((call) =>
      call.graphInputs?.some((input) => (input as { assetId?: string }).assetId === "plan_1")
    )
  );
  assert.ok(created.every((call) => call.sessionClaimGeneration === 7));
  assert.deepEqual(selected, [
    { assetId: "audio_1", role: "voiceover", slotKey: "beat_1" },
    { assetId: "audio_2", role: "voiceover", slotKey: "beat_2" },
    { assetId: "audio_3", role: "soundtrack", slotKey: "main" },
  ]);
  assert.deepEqual(spy.succeededResult, {
    assetIds: ["audio_1", "audio_2", "audio_3"],
  });
  assert.equal(resumedRun, "run_1");
  assert.ok(!spy.calls.includes("fail"));
});

test("runGenerateAudioJob honors selected user audio slots instead of regenerating them", async () => {
  const spy = jobsSpy();
  const createdRoles: string[] = [];

  await runGenerateAudioJob(
    {
      jobId: "job_1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      plan,
      planAssetId: "plan_1",
      planContentHash: "plan_hash",
      provider: "mock",
    },
    {
      jobs: spy.jobs,
      getActiveProjectScopedAsset: async ({ slotRole }) =>
        slotRole === "voiceover:beat_1"
          ? ({
              id: "uploaded_voiceover",
              source: { type: "remote_url", url: "https://example.com/voiceover.mp3" },
            } as never)
          : null,
      createGeneratedAsset: async (args) => {
        createdRoles.push((args.body as { assetRole?: string }).assetRole ?? "");
        return {
          status: 202,
          body: { job: { result: { assetIds: [`generated_${createdRoles.length}`] } } },
        };
      },
      selectGeneratedAudioAsset: async () => ({} as never),
    }
  );

  assert.deepEqual(createdRoles, ["voiceover", "soundtrack"]);
  assert.deepEqual(spy.succeededResult, {
    assetIds: ["uploaded_voiceover", "generated_1", "generated_2"],
  });
  assert.ok(!spy.calls.includes("fail"));
});

test("runGenerateAudioJob single-track mode creates one pooled asset without reading a plan or selection", async () => {
  const spy = jobsSpy();
  const bodies: Array<Record<string, unknown>> = [];
  const claimGenerations: Array<number | undefined> = [];

  await runGenerateAudioJob(
    {
      jobId: "job_1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      orchestratorRunId: "run_1",
      sessionClaimGeneration: 11,
      mode: "single_track",
      taskKind: "soundtrack_create",
      graphInputs: [
        {
          assetId: "reference_1",
          relation: "input",
          role: "reference",
          position: 0,
          contentHash: "reference_hash",
        },
      ],
      singleTrack: {
        prompt: "Warm analog instrumental underscore.",
        description: "Standalone warm analog instrumental underscore.",
        displayName: "Warm Analog Underscore",
        durationSec: 15,
        audioMode: "music",
        assetRole: "soundtrack",
        forceInstrumental: true,
      },
    },
    {
      jobs: spy.jobs,
      getActiveProjectScopedAsset: async () =>
        assert.fail("single-track mode must not read production selections"),
      createGeneratedAsset: async (args) => {
        bodies.push(args.body as Record<string, unknown>);
        claimGenerations.push(args.sessionClaimGeneration);
        return {
          status: 202,
          body: { job: { result: { assetIds: ["standalone_audio"] } } },
        };
      },
      selectGeneratedAudioAsset: async () =>
        assert.fail("single-track mode must not move a production selection"),
    }
  );

  assert.equal(bodies.length, 1);
  assert.equal(bodies[0]?.audioMode, "music");
  assert.equal(bodies[0]?.runId, "run_1");
  assert.deepEqual(bodies[0]?.referenceAssetIds, ["reference_1"]);
  assert.deepEqual(claimGenerations, [11]);
  assert.deepEqual(spy.succeededResult, { assetIds: ["standalone_audio"] });
});

test("runGenerateAudioJob forwards the exact revision source to generated-assets", async () => {
  const spy = jobsSpy();
  let body: Record<string, unknown> | undefined;

  await runGenerateAudioJob(
    {
      jobId: "job_1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      mode: "single_track",
      taskKind: "audio_revision",
      graphInputs: [
        {
          assetId: "source_audio",
          relation: "input",
          role: "source",
          position: 0,
          contentHash: "source_hash",
        },
      ],
      singleTrack: {
        prompt: "The exact approved words.",
        description: "Warmer delivery of the approved words.",
        displayName: "Warm Voiceover",
        durationSec: 8,
        audioMode: "speech",
        assetRole: "voiceover",
        sourceAssetId: "source_audio",
        voiceSettings: {
          stability: 0.35,
          similarityBoost: 0.75,
          style: 0.35,
          speed: 0.95,
          useSpeakerBoost: true,
        },
      },
    },
    {
      jobs: spy.jobs,
      getActiveProjectScopedAsset: async () =>
        assert.fail("single-track mode must not read production selections"),
      createGeneratedAsset: async (args) => {
        body = args.body as Record<string, unknown>;
        return {
          status: 202,
          body: { job: { result: { assetIds: ["revised_audio"] } } },
        };
      },
      selectGeneratedAudioAsset: async () =>
        assert.fail("single-track mode must not move a production selection"),
    }
  );

  assert.equal(body?.sourceAssetId, "source_audio");
  assert.equal(body?.prompt, "The exact approved words.");
  assert.deepEqual(body?.voiceSettings, {
    stability: 0.35,
    similarityBoost: 0.75,
    style: 0.35,
    speed: 0.95,
    useSpeakerBoost: true,
  });
  assert.deepEqual(spy.succeededResult, { assetIds: ["revised_audio"] });
});

test("runGenerateAudioJob regenerates stale generated audio selections", async () => {
  const spy = jobsSpy();
  const createdRoles: string[] = [];

  await runGenerateAudioJob(
    {
      jobId: "job_1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      plan,
      planAssetId: "plan_1",
      planContentHash: "new_plan_hash",
      briefAssetId: "brief_1",
      briefContentHash: "new_brief_hash",
      provider: "mock",
    },
    {
      jobs: spy.jobs,
      getActiveProjectScopedAsset: async ({ slotRole }) =>
        slotRole === "voiceover:beat_1"
          ? ({
              id: "stale_generated_voiceover",
              source: { type: "generated", generatedAssetId: "old_job_asset" },
              graphInputs: [
                {
                  assetId: "plan_1",
                  relation: "input",
                  role: "plan",
                  contentHash: "old_plan_hash",
                },
              ],
            } as never)
          : null,
      createGeneratedAsset: async (args) => {
        createdRoles.push((args.body as { assetRole?: string }).assetRole ?? "");
        return {
          status: 202,
          body: { job: { result: { assetIds: [`fresh_${createdRoles.length}`] } } },
        };
      },
      selectGeneratedAudioAsset: async () => ({} as never),
    }
  );

  assert.deepEqual(createdRoles, ["voiceover", "voiceover", "soundtrack"]);
  assert.deepEqual(spy.succeededResult, {
    assetIds: ["fresh_1", "fresh_2", "fresh_3"],
  });
  assert.ok(!spy.calls.includes("fail"));
});
