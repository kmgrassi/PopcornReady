import assert from "node:assert/strict";
import test from "node:test";
import type { DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";
import type { AuthContext } from "@/lib/api/v1/auth";
import type { ProjectGraphSnapshot } from "@/lib/orchestrator-context/graph-snapshot";
import {
  createAudioDomainFitTool,
  createAudioDomainGenerateTool,
} from "../audio-domain-tools";
import { ToolRegistry } from "../registry";

const projectId = "project_1";
const workspaceId = "workspace_1";
const auth: AuthContext = {
  mode: "local",
  actor: { id: "orchestrator", type: "local" },
  workspaceId,
  isLocal: true,
};

function snapshot(): ProjectGraphSnapshot {
  return {
    projectId,
    workspaceId,
    loadedAt: "2026-07-27T18:00:00.000Z",
    assets: [
      {
        id: "audio_source",
        projectId,
        workspaceId,
        lineageId: "lineage_audio",
        version: 1,
        kind: "audio_track",
        media: "audio",
        role: "voiceover",
        status: "ready",
        durationSec: 8,
        contentHash: "audio_hash",
        inputs: [],
        createdAt: "2026-07-27T17:00:00.000Z",
      },
      {
        id: "picture_1",
        projectId,
        workspaceId,
        lineageId: "lineage_picture",
        version: 1,
        kind: "clip",
        media: "video",
        status: "ready",
        durationSec: 5,
        contentHash: "picture_hash",
        inputs: [],
        createdAt: "2026-07-27T17:00:00.000Z",
      },
      {
        id: "script_asset",
        projectId,
        workspaceId,
        lineageId: "lineage_script",
        version: 1,
        kind: "script",
        media: "data",
        status: "ready",
        contentHash: "script_hash",
        inputs: [],
        createdAt: "2026-07-27T17:00:00.000Z",
      },
      {
        id: "plan_asset",
        projectId,
        workspaceId,
        lineageId: "lineage_plan",
        version: 1,
        kind: "shot_plan",
        media: "data",
        status: "ready",
        contentHash: "plan_hash",
        inputs: [
          {
            assetId: "script_asset",
            relation: "input",
            role: "script_draft",
            position: 0,
            contentHash: "script_hash",
          },
        ],
        createdAt: "2026-07-27T17:00:00.000Z",
      },
      {
        id: "foreign_to_task",
        projectId,
        workspaceId,
        lineageId: "lineage_foreign",
        version: 1,
        kind: "audio_track",
        media: "audio",
        status: "ready",
        inputs: [],
        createdAt: "2026-07-27T17:00:00.000Z",
      },
    ],
    selections: [],
    storyBlueprint: null,
    storyboards: [
      { id: "storyboard_1", projectId, status: "ready", planAssetId: null },
    ],
    scenes: [
      {
        id: "scene_1",
        projectId,
        storyboardId: "storyboard_1",
        sceneIndex: 0,
        status: "ready",
        sceneAssetId: null,
      },
      {
        id: "scene_2",
        projectId,
        storyboardId: "storyboard_1",
        sceneIndex: 1,
        status: "ready",
        sceneAssetId: null,
      },
    ],
    beats: [
      {
        id: "beat_1",
        projectId,
        sceneId: "scene_1",
        beatIndex: 0,
        intent: "Open on Maya.",
        status: "ready",
        beatAssetId: null,
      },
      {
        id: "beat_2",
        projectId,
        sceneId: "scene_2",
        beatIndex: 0,
        intent: "Unrelated second scene.",
        status: "ready",
        beatAssetId: null,
      },
    ],
    panels: [],
    actionLinks: [],
    runs: [],
    agentSessions: [],
    runGates: [],
    droppedForeignRowCount: 0,
  };
}

function audioTask(
  taskKind: "audio_production" | "audio_fit" | "audio_revision" | "soundtrack_create" | "audio_create",
  targets: DomainTaskV1["targets"] = [{ kind: "project", projectId }]
): Extract<DomainTaskV1, { domain: "audio" }> {
  const route =
    taskKind === "soundtrack_create" || taskKind === "audio_create"
      ? {
          origin: {
            kind: "creator_direct" as const,
            actorId: "actor_1",
            creatorMessageId: "message_1",
            entrypoint: "asset_studio" as const,
            requestDigest: "digest",
            idempotencyKey: "idem",
            approvalGateId: "gate_1",
          },
          responseRecipient: { kind: "creator_conversation" as const },
          approvalContext: {
            proposalActionId: "proposal_1" as never,
            approvedBudgetUsd: 2,
            approvalFingerprint: "fingerprint",
          },
        }
      : {
          origin: {
            kind: "creative_director" as const,
            rootRunId: "root_1" as never,
            rootActionId: "action_1" as never,
            creatorMessageId: "message_1",
          },
          responseRecipient: { kind: "creative_director" as const },
        };
  return {
    schemaVersion: "DomainTask.v1",
    domain: "audio",
    taskKind,
    objective: "Produce bounded audio.",
    instruction: "Warm, intimate delivery.",
    targets,
    requiredOutputs: [{ kind: "audio_track", role: "primary", minimumCount: 1 }],
    allowedOutputKinds: ["audio_track"],
    creativeConstraints: { tone: "warm" },
    preserve: { assetIds: [], selections: [], fingerprints: [], pins: [] },
    candidateAffectedAssetIds: [],
    budgetUsd: 2,
    acceptanceCriteria: ["The requested audio exists."],
    ...route,
  } as Extract<DomainTaskV1, { domain: "audio" }>;
}

function generationHarness(
  task: Extract<DomainTaskV1, { domain: "audio" }>,
  sourceOverrides: {
    kind?: "audio" | "video";
    status?: "ready" | "pending";
    planUsesCurrentScript?: boolean;
    role?: "voiceover" | "dialogue" | "sound_effect" | "soundtrack";
    audioMode?: "speech" | "dialogue" | "sound_effect" | "music";
    reorderPlanWithoutMapping?: boolean;
    scriptAvailable?: boolean;
    sourcePrompt?: string;
    sourceProviderPrompt?: string;
  } = {}
) {
  let workerInput: Record<string, unknown> | undefined;
  let jobCreates = 0;
  const planScenes = [
    {
      id: "script_scene_1",
      name: "Opening",
      beats: [
        { id: "beat_1", name: "Hook", durationSec: 8, intent: "Open on Maya." },
      ],
    },
    {
      id: "script_scene_2",
      name: "Second scene",
      beats: [
        {
          id: "beat_2",
          name: "Second beat",
          durationSec: 4,
          intent: "Unrelated second scene.",
        },
      ],
    },
  ];
  if (sourceOverrides.reorderPlanWithoutMapping) {
    planScenes.reverse();
    planScenes[0] = { ...planScenes[0], name: "Renamed first plan scene" };
    planScenes[1] = { ...planScenes[1], name: "Renamed second plan scene" };
  }
  const tool = createAudioDomainGenerateTool(task, {
    loadSnapshot: async () => {
      const current = snapshot();
      if (sourceOverrides.planUsesCurrentScript === false) {
        const planAsset = current.assets.find((asset) => asset.id === "plan_asset");
        if (planAsset) planAsset.inputs = [];
      }
      return current;
    },
    getPlan: async () => ({
      plan: {
        targetLengthSec: 12,
        style: "documentary",
        aspectRatio: "16:9",
        scenes: planScenes,
      },
      assetId: "plan_asset",
      contentHash: "plan_hash",
    }),
    getBrief: async () => null,
    getScript: async () =>
      sourceOverrides.scriptAvailable === false
        ? null
        : {
            scriptDraft: {
        schemaVersion: "scriptDraft.v1",
        id: "script_1",
        projectId,
        briefAssetId: "brief_asset",
        storyBlueprintId: "story_1",
        targetLengthSec: 8,
        durationClass: "short",
        durationPlan: {
          targetLengthSec: 8,
          durationClass: "short",
          expectedActCount: 1,
          expectedSceneCount: 1,
          expectedBeatCount: 1,
          planningGranularity: "scenes_and_beats",
        },
        status: "draft",
        scenes: [
          {
            id: "scene_1",
            title: "Opening",
            summary: "Maya opens the cafe.",
            narration: "Maya opens the doors before sunrise.",
            dialogue: [
              {
                characterName: "Maya",
                text: "The first scene line stays here.",
              },
            ],
          },
          {
            id: "scene_2",
            title: "Second scene",
            summary: "An unrelated scene.",
            narration: "This unrelated narration must not be spoken for beat one.",
            dialogue: [
              {
                characterName: "Jon",
                text: "The unrelated second-scene line must stay out.",
              },
            ],
          },
        ],
        narration:
          "Maya opens the doors before sunrise. This unrelated narration must not be spoken for beat one.",
        createdAt: "2026-07-27T17:00:00.000Z",
        updatedAt: "2026-07-27T17:00:00.000Z",
            },
            scriptDraftId: "script_1",
            assetId: "script_asset",
            contentHash: "script_hash",
          },
    getAsset: async (_workspace, _project, assetId) =>
      ({
        id: assetId,
        schemaVersion: "asset.v1",
        workspaceId,
        projectId,
        kind: sourceOverrides.kind ?? "audio",
        filename: "source.mp3",
        status: sourceOverrides.status ?? "ready",
        source: { type: "generated", generatedAssetId: assetId },
        role: sourceOverrides.role ?? "voiceover",
        provenance: {
          provider: "mock",
          prompt:
            sourceOverrides.sourcePrompt ?? "The exact original sentence.",
          ...(sourceOverrides.sourceProviderPrompt
            ? { providerPrompt: sourceOverrides.sourceProviderPrompt }
            : {}),
          providerSettings: {
            audioMode: sourceOverrides.audioMode ?? "speech",
          },
        },
        createdAt: "2026-07-27T17:00:00.000Z",
        updatedAt: "2026-07-27T17:00:00.000Z",
      }) as never,
    createJob: async (input) => {
      jobCreates += 1;
      workerInput = input.execution?.input;
      return {
        job: { id: "job_1", status: "queued" as const },
        created: true,
      };
    },
    runGenerateAudioJob: async () => {},
  });
  const registry = new ToolRegistry();
  registry.register(tool);
  return {
    registry,
    get workerInput() {
      return workerInput;
    },
    get jobCreates() {
      return jobCreates;
    },
  };
}

test("standalone soundtrack creates one no-plan, unselected single-track job", async () => {
  const harness = generationHarness(audioTask("soundtrack_create"));
  const result = await harness.registry.execute(
    "generate_audio",
    {
      target: { kind: "project", projectId, contentKind: "music" },
      prompt: "A patient analog-synth score.",
      durationSec: 30,
      provider: "mock",
    },
    {
      auth,
      projectId,
      orchestratorRunId: "run_1",
      actionId: "outer_action",
      sessionClaimGeneration: 13,
    }
  );
  assert.equal(result.status, "accepted");
  assert.equal(harness.workerInput?.mode, "single_track");
  assert.equal("plan" in (harness.workerInput ?? {}), false);
  const track = harness.workerInput?.singleTrack as Record<string, unknown>;
  assert.equal(track.assetRole, "soundtrack");
  assert.equal(track.audioMode, "music");
  assert.equal(track.forceInstrumental, true);
  assert.equal("selection" in track, false);
  assert.equal(harness.workerInput?.sessionClaimGeneration, 13);
});

test("production narration uses exact pinned script copy, not beat intent or model paraphrase", async () => {
  const harness = generationHarness(audioTask("audio_production"));
  await harness.registry.execute(
    "generate_audio",
    {
      target: { kind: "beat", beatId: "beat_1", contentKind: "narration" },
      spokenText: "A model-authored paraphrase that must not be spoken.",
      feedback: "Warmer delivery.",
    },
    { auth, projectId, orchestratorRunId: "run_1", actionId: "outer_action" }
  );
  const track = harness.workerInput?.singleTrack as Record<string, unknown>;
  assert.equal(track.prompt, "Maya opens the doors before sunrise.");
  const inputs = harness.workerInput?.graphInputs as Array<Record<string, unknown>>;
  assert.ok(inputs.some((input) => input.assetId === "script_asset" && input.role === "script"));
  assert.ok(inputs.some((input) => input.assetId === "plan_asset" && input.role === "plan"));
});

test("production speech rejects model-authored words when no trusted script exists", async () => {
  const targets = [
    { kind: "project", projectId, contentKind: "narration" },
    { kind: "beat", beatId: "beat_1", contentKind: "dialogue" },
  ] as const;
  for (const target of targets) {
    const harness = generationHarness(audioTask("audio_production"), {
      scriptAvailable: false,
    });
    const result = await harness.registry.execute(
      "generate_audio",
      {
        target,
        spokenText: "Model-authored words are not approved production copy.",
      },
      { auth, projectId, orchestratorRunId: "run_1", actionId: "outer_action" }
    );
    assert.equal(result.status, "failed");
    assert.equal(result.error?.kind, "precondition_unmet");
    assert.equal(harness.jobCreates, 0);
  }
});

test("production music inherits the current plan duration and graph provenance", async () => {
  const harness = generationHarness(audioTask("audio_production"));
  await harness.registry.execute(
    "generate_audio",
    {
      target: { kind: "project", projectId, contentKind: "music" },
      prompt: "A restrained instrumental bed.",
    },
    { auth, projectId, orchestratorRunId: "run_1", actionId: "outer_action" }
  );
  const track = harness.workerInput?.singleTrack as Record<string, unknown>;
  assert.equal(track.durationSec, 12);
  assert.equal(track.audioMode, "music");
  const inputs = harness.workerInput?.graphInputs as Array<Record<string, unknown>>;
  assert.ok(inputs.some((input) => input.assetId === "plan_asset" && input.role === "plan"));
});

test("beat-targeted dialogue includes only the script scene mapped by the plan", async () => {
  const harness = generationHarness(audioTask("audio_production"));
  await harness.registry.execute(
    "generate_audio",
    {
      target: { kind: "beat", beatId: "beat_1", contentKind: "dialogue" },
      voiceId: "voice_1",
    },
    { auth, projectId, orchestratorRunId: "run_1", actionId: "outer_action" }
  );
  const track = harness.workerInput?.singleTrack as Record<string, unknown>;
  assert.equal(track.prompt, "The first scene line stays here.");
  assert.deepEqual(track.dialogueInputs, [
    { text: "The first scene line stays here.", voiceId: "voice_1" },
  ]);
});

test("beat-targeted speech fails closed when the plan does not derive from the current script", async () => {
  const harness = generationHarness(audioTask("audio_production"), {
    planUsesCurrentScript: false,
  });
  const result = await harness.registry.execute(
    "generate_audio",
    {
      target: { kind: "beat", beatId: "beat_1", contentKind: "narration" },
    },
    { auth, projectId, orchestratorRunId: "run_1", actionId: "outer_action" }
  );
  assert.equal(result.status, "failed");
  assert.equal(result.error?.kind, "precondition_unmet");
  assert.equal(harness.jobCreates, 0);
});

test("beat-targeted speech fails closed when a derived plan reorders unmapped scenes", async () => {
  const harness = generationHarness(audioTask("audio_production"), {
    reorderPlanWithoutMapping: true,
  });
  const result = await harness.registry.execute(
    "generate_audio",
    {
      target: { kind: "beat", beatId: "beat_1", contentKind: "narration" },
    },
    { auth, projectId, orchestratorRunId: "run_1", actionId: "outer_action" }
  );
  assert.equal(result.status, "failed");
  assert.equal(result.error?.kind, "precondition_unmet");
  assert.equal(harness.jobCreates, 0);
});

test("audio revision preserves source words and records the immutable source edge", async () => {
  const task = audioTask("audio_revision", [
    { kind: "asset", projectId, assetId: "audio_source" },
  ]);
  const harness = generationHarness(task);
  await harness.registry.execute(
    "generate_audio",
    {
      target: { kind: "asset", assetId: "audio_source", contentKind: "narration" },
      spokenText: "Changed words are not authorized.",
      feedback: "Redo warmer with a softer smile.",
      deliveryPreset: "warm",
    },
    { auth, projectId, orchestratorRunId: "run_1", actionId: "outer_action" }
  );
  const track = harness.workerInput?.singleTrack as Record<string, unknown>;
  assert.equal(track.prompt, "The exact original sentence.");
  assert.equal(track.sourceAssetId, "audio_source");
  assert.deepEqual(track.voiceSettings, {
    stability: 0.35,
    similarityBoost: 0.75,
    style: 0.35,
    speed: 0.95,
    useSpeakerBoost: true,
  });
  const inputs = harness.workerInput?.graphInputs as Array<Record<string, unknown>>;
  assert.ok(inputs.some((input) => input.assetId === "audio_source" && input.role === "source"));
});

test("audio revision speaks provider-effective text rather than delivery directives", async () => {
  const task = audioTask("audio_revision", [
    { kind: "asset", projectId, assetId: "audio_source" },
  ]);
  const harness = generationHarness(task, {
    sourcePrompt: "[Delivery: warm]\nThe exact original sentence.",
    sourceProviderPrompt: "The exact original sentence.",
  });
  await harness.registry.execute(
    "generate_audio",
    {
      target: {
        kind: "asset",
        assetId: "audio_source",
        contentKind: "narration",
      },
    },
    { auth, projectId, orchestratorRunId: "run_1", actionId: "outer_action" }
  );
  const track = harness.workerInput?.singleTrack as Record<string, unknown>;
  assert.equal(track.prompt, "The exact original sentence.");
});

test("audio revision rejects project-wide authority without an explicit source target or pin", async () => {
  const harness = generationHarness(audioTask("audio_revision"));
  const result = await harness.registry.execute(
      "generate_audio",
      {
        target: {
          kind: "asset",
          assetId: "audio_source",
          contentKind: "narration",
        },
      },
      { auth, projectId, orchestratorRunId: "run_1", actionId: "outer_action" }
  );
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.match(result.error.message, /explicit trusted asset target/);
  }
  assert.equal(harness.jobCreates, 0);
});

test("audio revision rejects a non-ready source before creating a provider job", async () => {
  const task = audioTask("audio_revision", [
    { kind: "asset", projectId, assetId: "audio_source" },
  ]);
  const harness = generationHarness(task, { status: "pending" });
  const result = await harness.registry.execute(
    "generate_audio",
    {
      target: {
        kind: "asset",
        assetId: "audio_source",
        contentKind: "narration",
      },
    },
    { auth, projectId, orchestratorRunId: "run_1", actionId: "outer_action" }
  );
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.match(result.error.message, /ready audio_track/);
  }
  assert.equal(harness.jobCreates, 0);
});

test("audio revision rejects a source subtype change before creating a provider job", async () => {
  const task = audioTask("audio_revision", [
    { kind: "asset", projectId, assetId: "audio_source" },
  ]);
  const harness = generationHarness(task, {
    role: "soundtrack",
    audioMode: "music",
  });
  const result = await harness.registry.execute(
    "generate_audio",
    {
      target: {
        kind: "asset",
        assetId: "audio_source",
        contentKind: "narration",
      },
    },
    { auth, projectId, orchestratorRunId: "run_1", actionId: "outer_action" }
  );
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.match(result.error.message, /trusted source audio subtype/);
  }
  assert.equal(harness.jobCreates, 0);
});

test("foreign targets fail before provider job creation", async () => {
  const task = audioTask("audio_revision", [
    { kind: "asset", projectId, assetId: "audio_source" },
  ]);
  const harness = generationHarness(task);
  const result = await harness.registry.execute(
      "generate_audio",
      {
        target: { kind: "asset", assetId: "foreign_to_task", contentKind: "music" },
      },
      { auth, projectId, orchestratorRunId: "run_1", actionId: "outer_action" }
  );
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.match(result.error.message, /explicit trusted asset target/);
  }
  assert.equal(harness.jobCreates, 0);
});

test("fit requires current picture and passes only scoped audio/picture targets", async () => {
  const task = audioTask("audio_fit", [
    { kind: "beat", projectId, beatId: "beat_1" },
    { kind: "asset", projectId, assetId: "audio_source" },
    { kind: "asset", projectId, assetId: "picture_1" },
  ]);
  let request: unknown;
  const tool = createAudioDomainFitTool(task, {
    loadSnapshot: async () => snapshot(),
    fitProjectAudioToPicture: async (input) => {
      request = input.request;
      return {
        audioAssetId: "audio_source",
        beatId: "beat_1",
        critiqueAssetId: "critique_1",
        verdict: "fail",
        requiresApproval: true,
        placement: { startSec: 0, endSec: 5 },
        retime: { applied: false, factor: 1.6, maxRetime: 0.1 },
        reasons: ["retime_exceeds_cap", "regenerate"],
        metrics: {
          audioDurationSec: 8,
          targetDurationSec: 5,
          durationDeltaSec: 3,
        },
      };
    },
  });
  const missing = await tool.execute(
    { audioAssetId: "audio_source", beatId: "beat_1" },
    { auth, projectId }
  );
  assert.equal(missing.status, "failed");
  if (missing.status === "failed") {
    assert.equal(missing.error.unmetRequirements?.[0]?.satisfyWith.tool, "generate_clip");
  }
  assert.throws(
    () =>
      tool.parseInput({
        audioAssetId: "audio_source",
        pictureAssetId: "picture_1",
        beatId: "beat_1",
        options: {
          targetWindow: { startSec: 0, endSec: 100 },
          words: [{ w: "injected", startSec: 0, endSec: 1 }],
        },
      }),
    /server-owned picture/
  );
  const result = await tool.execute(
    {
      audioAssetId: "audio_source",
      pictureAssetId: "picture_1",
      beatId: "beat_1",
    },
    { auth, projectId }
  );
  assert.equal(result.status, "succeeded");
  assert.deepEqual(request, {
    audioAssetId: "audio_source",
    pictureAssetId: "picture_1",
    beatId: "beat_1",
  });
});

test("fit rejects project-wide authority without exact audio, picture, and beat targets", async () => {
  const tool = createAudioDomainFitTool(audioTask("audio_fit"), {
    loadSnapshot: async () => snapshot(),
    fitProjectAudioToPicture: async () =>
      assert.fail("an unbounded fit must not reach the service"),
  });
  await assert.rejects(
    async () =>
      await tool.execute(
        {
          audioAssetId: "audio_source",
          pictureAssetId: "picture_1",
          beatId: "beat_1",
        },
        { auth, projectId }
      ),
    /explicit trusted audio, picture, and beat/
  );
});
