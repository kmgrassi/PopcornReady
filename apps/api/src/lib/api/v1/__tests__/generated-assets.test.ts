import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Point the agent store + generated media at a throwaway temp dir before any
// store call. store.localDir()/jobs read this lazily, so setting it here is enough.
process.env.POPCORN_READY_LOCAL_DIR = path.join(
  os.tmpdir(),
  `popcornready-pr2-${process.pid}-${Date.now()}`
);
delete process.env.AUTH_MODE;

import { AuthContext } from "../auth";
import { ApiError } from "../errors";

// DB-generated workspace uuid stand-in for these Supabase-gated tests (skipped
// unless SUPABASE_* env is set).
const LOCAL_WORKSPACE_ID = "00000000-0000-0000-0000-000000000001";
import {
  createGeneratedAsset,
  getGeneratedAssetJob,
  reserveGeneratedAssetProviderBudget,
} from "../generated-assets";
import { V1Job } from "../jobs";
import { createProject, getAsset, listAssets } from "../store";
import { getServiceSupabase } from "@/lib/supabase/clients";

// These exercise the v1 store, which now persists to Supabase Postgres (needs a
// live PostgREST gateway). Skipped unless Supabase env is configured; the store's
// asset round-trips are proven by the dockerized pg harness in this PR.
const SUPABASE_CONFIGURED = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);
const dbTest: typeof test = SUPABASE_CONFIGURED ? test : (test.skip as typeof test);

const auth: AuthContext = {
  mode: "local",
  actor: { id: "local_dev", type: "local" },
  workspaceId: LOCAL_WORKSPACE_ID,
  isLocal: true,
};

async function newProjectId(name: string): Promise<string> {
  const { project } = await createProject({
    workspaceId: LOCAL_WORKSPACE_ID,
    name,
  });
  return project.id;
}

function jobOf(result: { body: Record<string, unknown> }): V1Job {
  return result.body.job as V1Job;
}

function assetIds(job: V1Job): string[] {
  return (job.result as { assetIds: string[] }).assetIds;
}

async function expectApiError(
  promise: Promise<unknown>,
  code: ApiError["code"]
): Promise<void> {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof ApiError, `expected ApiError, got ${err}`);
    assert.equal(err.code, code);
    return true;
  });
}

test("proposal-bound generated assets reserve once under the approved child causation", async () => {
  const nested: Record<string, unknown>[] = [];
  const ordinary: Record<string, unknown>[] = [];
  const result = await reserveGeneratedAssetProviderBudget({
    projectId: "project-1",
    runId: "child-run-1",
    actionId: "primitive-action-1",
    jobId: "provider-job-1",
    reservationKey: "generated-asset:provider-job-1",
    estimatedUsd: 0.37,
  }, {
    getDomainRun: async () => ({
      taskParams: {
        approvalContext: {
          executionReservationId: "execution-1",
          rerunCallback: {
            workItemId: "work-audio",
          },
        },
      },
    }) as never,
    reserveRerunChildBudget: async (input) => {
      nested.push(input);
      return { reservationId: "nested-1", replayed: false };
    },
    reserveOrchestratorBudget: async (input) => {
      ordinary.push(input as unknown as Record<string, unknown>);
      return null;
    },
  });

  assert.deepEqual(result, {
    reservationId: "nested-1",
    replayed: false,
  });
  assert.deepEqual(nested, [{
    projectId: "project-1",
    executionReservationId: "execution-1",
    workItemId: "work-audio",
    actionId: "primitive-action-1",
    childRunId: "child-run-1",
    jobId: "provider-job-1",
    reservationKey: "generated-asset:provider-job-1",
    estimatedUsd: 0.37,
  }]);
  assert.deepEqual(ordinary, []);
});

dbTest("creates image, video, and audio generated assets and lists them", async () => {
  const projectId = await newProjectId("agent video");

  const image = await createGeneratedAsset({
    auth,
    projectId,
    body: { kind: "image", provider: "mock", prompt: "petri dish hook" },
  });
  assert.equal(image.status, 202);
  assert.equal(jobOf(image).status, "succeeded");
  assert.equal(jobOf(image).type, "asset_generation");

  const video = await createGeneratedAsset({
    auth,
    projectId,
    body: {
      kind: "video",
      provider: "mock",
      prompt: "workflow reveal",
      durationSec: 6,
    },
  });
  assert.equal(jobOf(video).status, "succeeded");

  const audio = await createGeneratedAsset({
    auth,
    projectId,
    body: {
      kind: "audio",
      provider: "mock",
      prompt: "calm narration",
      durationSec: 5,
    },
  });
  assert.equal(jobOf(audio).status, "succeeded");

  // Poll the job through the GET endpoint.
  const polled = await getGeneratedAssetJob({
    auth,
    projectId,
    jobId: jobOf(audio).id,
  });
  assert.equal(jobOf(polled).status, "succeeded");

  // List through the standard PR1 asset store (what GET /assets surfaces).
  const { items } = await listAssets(LOCAL_WORKSPACE_ID, projectId, 50, null);
  assert.equal(items.length, 3);
  assert.deepEqual(
    [...items.map((a) => a.kind)].sort(),
    ["audio", "image", "video"]
  );
  assert.ok(items.every((a) => a.source.type === "generated"));
  assert.ok(
    items.every(
      (asset) =>
        asset.storageKey ===
        `${LOCAL_WORKSPACE_ID}/${projectId}/${asset.id}/${asset.filename}`
    )
  );
  assert.ok(items.every((asset) => asset.storageBucket === "assets-public"));
  for (const asset of items) {
    const bytes = await fs.readFile(
      path.join(process.env.POPCORN_READY_LOCAL_DIR!, asset.storageKey!)
    );
    assert.ok(bytes.length > 0);
  }
});

dbTest(
  "loads generated references from the object store when the database backend is Supabase",
  async () => {
    const projectId = await newProjectId("object store references");
    const referenceResult = await createGeneratedAsset({
      auth,
      projectId,
      body: {
        kind: "image",
        provider: "mock",
        prompt: "storyboard reference",
      },
    });
    const referenceId = assetIds(jobOf(referenceResult))[0];
    const reference = await getAsset(LOCAL_WORKSPACE_ID, projectId, referenceId);
    assert.equal(reference.status, "ready");
    assert.equal(reference.storageBucket, "assets-public");

    const generated = await createGeneratedAsset({
      auth,
      projectId,
      body: {
        kind: "image",
        provider: "mock",
        prompt: "keyframe conditioned on the storyboard",
        referenceAssetIds: [referenceId],
      },
    });

    assert.equal(jobOf(generated).status, "succeeded");
    const output = await getAsset(
      LOCAL_WORKSPACE_ID,
      projectId,
      assetIds(jobOf(generated))[0]
    );
    assert.equal(output.status, "ready");
  }
);

dbTest("persists actual audio duration in provenance", async () => {
  const projectId = await newProjectId("audio provenance");

  const res = await createGeneratedAsset({
    auth,
    projectId,
    body: {
      kind: "audio",
      provider: "mock",
      prompt: "five second line",
      durationSec: 5,
    },
  });

  const id = assetIds(jobOf(res))[0];
  const asset = await getAsset(LOCAL_WORKSPACE_ID, projectId, id);
  assert.equal(asset.kind, "audio");
  assert.equal(asset.provenance?.provider, "mock");
  assert.equal(asset.provenance?.requestedDurationSec, 5);
  // Mock returns a real 8kHz WAV of the requested length.
  assert.equal(asset.provenance?.actualDurationSec, 5);
  assert.equal(asset.durationSec, 5);
});

dbTest("audio revisions mint a new immutable version without overwriting source bytes", async () => {
  const projectId = await newProjectId("immutable audio revision");
  const sourceResult = await createGeneratedAsset({
    auth,
    projectId,
    body: {
      kind: "audio",
      provider: "mock",
      prompt: "The exact approved sentence.",
      durationSec: 4,
      audioMode: "speech",
    },
  });
  const sourceId = assetIds(jobOf(sourceResult))[0];
  const sourceBefore = await getAsset(LOCAL_WORKSPACE_ID, projectId, sourceId);
  const sourceBytesBefore = await fs.readFile(
    path.join(process.env.POPCORN_READY_LOCAL_DIR!, sourceBefore.storageKey!)
  );

  const revisionResult = await createGeneratedAsset({
    auth,
    projectId,
    body: {
      kind: "audio",
      provider: "mock",
      prompt: "The exact approved sentence.",
      description: "Warmer delivery; unchanged words.",
      durationSec: 4,
      audioMode: "speech",
      sourceAssetId: sourceId,
      graphInputs: [
        {
          assetId: sourceId,
          relation: "input",
          role: "source",
          position: 0,
          contentHash: sourceBefore.contentHash,
        },
      ],
    },
  });

  const revisionId = assetIds(jobOf(revisionResult))[0];
  const [sourceAfter, revision] = await Promise.all([
    getAsset(LOCAL_WORKSPACE_ID, projectId, sourceId),
    getAsset(LOCAL_WORKSPACE_ID, projectId, revisionId),
  ]);
  const sourceBytesAfter = await fs.readFile(
    path.join(process.env.POPCORN_READY_LOCAL_DIR!, sourceAfter.storageKey!)
  );

  assert.notEqual(revision.id, sourceAfter.id);
  assert.notEqual(revision.storageKey, sourceAfter.storageKey);
  assert.equal(
    revision.graphInputs?.some(
      (edge) => edge.assetId === sourceId && edge.role === "source"
    ),
    true
  );
  const { data: lineageRows, error: lineageError } = await getServiceSupabase()
    .from("assets")
    .select("id, lineage_id, version")
    .in("id", [sourceId, revisionId])
    .order("version", { ascending: true });
  assert.equal(lineageError, null);
  assert.equal(lineageRows?.length, 2);
  assert.equal(lineageRows?.[0]?.lineage_id, lineageRows?.[1]?.lineage_id);
  assert.equal(lineageRows?.[1]?.version, Number(lineageRows?.[0]?.version) + 1);
  assert.deepEqual(sourceBytesAfter, sourceBytesBefore);
});

dbTest("image revisions mint a pooled immutable version in the source lineage", async () => {
  const projectId = await newProjectId("immutable image revision");
  const sourceResult = await createGeneratedAsset({
    auth,
    projectId,
    body: {
      kind: "image",
      provider: "mock",
      prompt: "Original keyframe.",
      assetRole: "beat_keyframe",
    },
  });
  const sourceId = assetIds(jobOf(sourceResult))[0]!;
  const source = await getAsset(LOCAL_WORKSPACE_ID, projectId, sourceId);
  const revisionResult = await createGeneratedAsset({
    auth,
    projectId,
    body: {
      kind: "image",
      provider: "mock",
      prompt: "Warmer keyframe.",
      assetRole: "beat_keyframe",
      sourceAssetId: sourceId,
      referenceAssetIds: [sourceId],
      graphInputs: [{
        assetId: sourceId,
        relation: "input",
        role: "source",
        position: 0,
        contentHash: source.contentHash,
      }],
    },
  });
  const revisionId = assetIds(jobOf(revisionResult))[0]!;
  const { data, error } = await getServiceSupabase()
    .from("assets")
    .select("id,lineage_id,version")
    .in("id", [sourceId, revisionId])
    .order("version");
  assert.equal(error, null);
  assert.equal(data?.length, 2);
  assert.equal(data?.[0]?.lineage_id, data?.[1]?.lineage_id);
  assert.equal(data?.[1]?.version, Number(data?.[0]?.version) + 1);
});

dbTest("approved input pins are revalidated after durable provider claim", async () => {
  const projectId = await newProjectId("stale image pin");
  const sourceResult = await createGeneratedAsset({
    auth,
    projectId,
    body: { kind: "image", provider: "mock", prompt: "Pinned source." },
  });
  const sourceId = assetIds(jobOf(sourceResult))[0]!;
  const source = await getAsset(LOCAL_WORKSPACE_ID, projectId, sourceId);
  await expectApiError(
    createGeneratedAsset({
      auth,
      projectId,
      expectedAssetPins: [{
        assetId: sourceId,
        contentHash: `${source.contentHash}-stale`,
        inputsFingerprint: source.inputsFingerprint ?? null,
      }],
      body: {
        kind: "image",
        provider: "mock",
        prompt: "Must not call provider.",
        referenceAssetIds: [sourceId],
      },
    }),
    "validation_failed"
  );
  const { items } = await listAssets(LOCAL_WORKSPACE_ID, projectId, 50, null);
  assert.equal(items.length, 1);
});

dbTest("persists provider settings used to produce the asset", async () => {
  const projectId = await newProjectId("provider settings");

  const image = await createGeneratedAsset({
    auth,
    projectId,
    body: {
      kind: "image",
      provider: "mock",
      prompt: "settings",
      size: "1024x1024",
      quality: "high",
    },
  });
  const imageAsset = await getAsset(
    LOCAL_WORKSPACE_ID,
    projectId,
    assetIds(jobOf(image))[0]
  );
  assert.equal(imageAsset.provenance?.providerSettings?.size, "1024x1024");
  assert.equal(imageAsset.provenance?.providerSettings?.quality, "high");

  const audio = await createGeneratedAsset({
    auth,
    projectId,
    body: {
      kind: "audio",
      provider: "mock",
      prompt: "voice over",
      durationSec: 4,
      voiceId: "voice_123",
      outputFormat: "mp3_44100_192",
      audioMode: "speech",
      voiceSettings: {
        stability: 0.35,
        similarityBoost: 0.75,
        style: 0.35,
        speed: 0.95,
        useSpeakerBoost: true,
      },
    },
  });
  const audioAsset = await getAsset(
    LOCAL_WORKSPACE_ID,
    projectId,
    assetIds(jobOf(audio))[0]
  );
  assert.equal(audioAsset.provenance?.providerSettings?.voiceId, "voice_123");
  assert.equal(
    audioAsset.provenance?.providerSettings?.outputFormat,
    "mp3_44100_192"
  );
  assert.equal(audioAsset.provenance?.providerSettings?.audioMode, "speech");
  assert.deepEqual(audioAsset.provenance?.providerSettings?.voiceSettings, {
    stability: 0.35,
    similarityBoost: 0.75,
    style: 0.35,
    speed: 0.95,
    useSpeakerBoost: true,
  });
});

dbTest("routes NVIDIA Cosmos video through the generated-assets adapter", async (t) => {
  const projectId = await newProjectId("nvidia generated asset");
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.NVIDIA_API_KEY;
  const originalModel = process.env.NVIDIA_VIDEO_GENERATION_MODEL;
  const originalBaseUrl = process.env.NVIDIA_VIDEO_GENERATION_BASE_URL;
  const calls: { url: string; body: Record<string, unknown> }[] = [];

  process.env.NVIDIA_API_KEY = "nvidia-test-key";
  process.env.NVIDIA_VIDEO_GENERATION_MODEL = "nvidia/cosmos3-nano";
  process.env.NVIDIA_VIDEO_GENERATION_BASE_URL = "https://ai.api.nvidia.com/v1/genai";
  globalThis.fetch = (async (url, init) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body || "{}")),
    });
    return new Response(
      JSON.stringify({ b64_video: Buffer.from("mp4").toString("base64") }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = originalApiKey;
    if (originalModel === undefined) delete process.env.NVIDIA_VIDEO_GENERATION_MODEL;
    else process.env.NVIDIA_VIDEO_GENERATION_MODEL = originalModel;
    if (originalBaseUrl === undefined) {
      delete process.env.NVIDIA_VIDEO_GENERATION_BASE_URL;
    } else {
      process.env.NVIDIA_VIDEO_GENERATION_BASE_URL = originalBaseUrl;
    }
  });

  const res = await createGeneratedAsset({
    auth,
    projectId,
    body: {
      kind: "video",
      provider: "nvidia_api_catalog",
      prompt: "cosmos warehouse shot",
      durationSec: 4,
      resolution: "480_16_9",
      frameCount: 24,
      fps: 12,
      steps: 8,
      guidanceScale: 5,
      seed: 42,
      negativePrompt: "blur",
    },
  });

  assert.equal(jobOf(res).status, "succeeded");
  assert.equal(calls[0].url, "https://ai.api.nvidia.com/v1/genai/nvidia/cosmos3-nano");
  assert.deepEqual(calls[0].body, {
    prompt: "cosmos warehouse shot",
    negative_prompt: "blur",
    seed: 42,
    resolution: "480_16_9",
    num_output_frames: 24,
    fps: 12,
    steps: 8,
    guidance_scale: 5,
  });

  const asset = await getAsset(
    LOCAL_WORKSPACE_ID,
    projectId,
    assetIds(jobOf(res))[0]
  );
  assert.equal(asset.kind, "video");
  assert.equal(asset.provenance?.provider, "nvidia_api_catalog");
  assert.equal(asset.provenance?.providerSettings?.seed, 42);
  assert.equal(asset.provenance?.providerSettings?.frameCount, 24);
  assert.equal(asset.provenance?.providerSettings?.fps, 12);
  assert.equal(asset.provenance?.providerSettings?.steps, 8);
  assert.equal(asset.provenance?.providerSettings?.guidanceScale, 5);
  assert.equal(asset.provenance?.providerSettings?.negativePrompt, "blur");
  assert.equal(asset.provenance?.providerSettings?.resolution, "480_16_9");
});

dbTest("records character binding metadata when character fields are provided", async () => {
  const projectId = await newProjectId("character binding");

  const res = await createGeneratedAsset({
    auth,
    projectId,
    body: {
      kind: "image",
      provider: "mock",
      prompt: "fleming portrait",
      characterProfileIds: ["char_fleming"],
      characterReferenceIds: ["ref_hero"],
      consistencyMode: "hero_frame",
    },
  });

  const asset = await getAsset(
    LOCAL_WORKSPACE_ID,
    projectId,
    assetIds(jobOf(res))[0]
  );
  assert.deepEqual(asset.provenance?.characterBinding?.characterProfileIds, [
    "char_fleming",
  ]);
  assert.equal(
    asset.provenance?.characterBinding?.consistencyMode,
    "hero_frame"
  );
});

dbTest("returns typed errors for unsupported and invalid requests", async () => {
  const projectId = await newProjectId("errors");

  // Audio requested from an image/video-only provider.
  await expectApiError(
    createGeneratedAsset({
      auth,
      projectId,
      body: { kind: "audio", provider: "openai", prompt: "voice" },
    }),
    "validation_failed"
  );

  // Image requested from a video-only provider.
  await expectApiError(
    createGeneratedAsset({
      auth,
      projectId,
      body: { kind: "image", provider: "runway", prompt: "frame" },
    }),
    "validation_failed"
  );

  // Unknown provider.
  await expectApiError(
    createGeneratedAsset({
      auth,
      projectId,
      body: { kind: "image", provider: "made-up", prompt: "x" },
    }),
    "validation_failed"
  );

  // Invalid consistency mode.
  await expectApiError(
    createGeneratedAsset({
      auth,
      projectId,
      body: {
        kind: "image",
        provider: "mock",
        prompt: "x",
        consistencyMode: "telepathy",
      },
    }),
    "validation_failed"
  );

  // Missing prompt.
  await expectApiError(
    createGeneratedAsset({
      auth,
      projectId,
      body: { kind: "image", provider: "mock" },
    }),
    "validation_failed"
  );

  // Unknown project.
  await expectApiError(
    createGeneratedAsset({
      auth,
      projectId: "proj_missing",
      body: { kind: "image", provider: "mock", prompt: "x" },
    }),
    "not_found"
  );
});
