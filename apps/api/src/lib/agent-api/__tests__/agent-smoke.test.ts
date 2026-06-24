// End-to-end-ish smoke harness for the /api/v1 agent surface (PR6).
//
// What runs today: the job lifecycle, idempotency, the export duration policy,
// and local-mode actor resolution.
//
// The three full prompt->MP4 flows from the scope doc's PR6 acceptance criteria
// are declared as test.todo below. They cannot pass until PR1–PR5 land
// (project/asset/composition/generation/audio-alignment surfaces), which is the
// expected state for this scaffolding PR.

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AgentApiStore } from "../jobs";
import { ApiError, resolveActor } from "../runtime";
import { resolveExportDuration, runExportJob } from "../workers";
import { Project } from "@popcorn/shared/types";

async function tempStore(): Promise<AgentApiStore> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "popcornready-jobs-"));
  return new AgentApiStore(dir);
}

function projectFixture(): Project {
  return {
    id: "default",
    goal: "demo",
    plan: null,
    timeline: {
      aspectRatio: "9:16",
      fps: 30,
      segments: [
        { id: "seg_1", clipId: "clip_a", sourceInSec: 0, sourceOutSec: 3, role: "hook", reason: "" },
        { id: "seg_2", clipId: "clip_b", sourceInSec: 0, sourceOutSec: 2, role: "payoff", reason: "" },
      ],
    },
    clips: [
      { id: "clip_a", filename: "a.mp4", url: "/uploads/a.mp4", kind: "video", durationSec: 10, description: "" },
      { id: "clip_b", filename: "b.mp4", url: "/uploads/b.mp4", kind: "video", durationSec: 10, description: "" },
      { id: "clip_audio", filename: "n.mp3", url: "/uploads/n.mp3", kind: "audio", durationSec: 12, description: "" },
    ],
    critic: null,
    chat: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("job lifecycle: queued -> running -> succeeded", async () => {
  const store = await tempStore();
  const { job, created } = await store.createOrGetJob({
    type: "revision",
    projectId: "proj_1",
  });
  assert.equal(created, true);
  assert.match(
    job.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
  assert.equal(job.status, "queued");

  await store.setStep(job.id, "planning_timeline");
  const finished = await store.succeed(job.id, { ok: true });
  assert.equal(finished.status, "succeeded");
  assert.deepEqual(finished.result, { ok: true });

  const reloaded = await store.getJob(job.id);
  assert.equal(reloaded?.status, "succeeded");
});

test("idempotency: same key + type returns the same job", async () => {
  const store = await tempStore();
  const first = await store.createOrGetJob({
    type: "export",
    projectId: "proj_1",
    idempotencyKey: "export-001",
  });
  const second = await store.createOrGetJob({
    type: "export",
    projectId: "proj_1",
    idempotencyKey: "export-001",
  });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.job.id, second.job.id);
});

test("findLatestJobForProject recovers the newest in-flight job (reload case)", async () => {
  const store = await tempStore();

  // No jobs yet -> null.
  assert.equal(
    await store.findLatestJobForProject({ type: "asset_generation", projectId: "proj_1" }),
    null
  );

  const first = await store.createOrGetJob({
    type: "asset_generation",
    projectId: "proj_1",
    idempotencyKey: "gen-001",
  });
  const second = await store.createOrGetJob({
    type: "asset_generation",
    projectId: "proj_1",
    idempotencyKey: "gen-002",
  });

  // Returns the most recently created job for the project+type.
  const latest = await store.findLatestJobForProject({
    type: "asset_generation",
    projectId: "proj_1",
  });
  assert.equal(latest?.id, second.job.id);
  assert.notEqual(latest?.id, first.job.id);

  // Scoped by project and by type.
  assert.equal(
    await store.findLatestJobForProject({ type: "asset_generation", projectId: "proj_2" }),
    null
  );
  assert.equal(
    await store.findLatestJobForProject({ type: "export", projectId: "proj_1" }),
    null
  );
});

test("resolveExportDuration honors each duration policy", () => {
  // timeline=5s, audio=12s.
  assert.equal(
    resolveExportDuration({ timelineDurationSec: 5, audioDurationSec: 12, policy: "timeline_only" }).durationSec,
    5
  );
  assert.equal(
    resolveExportDuration({ timelineDurationSec: 5, audioDurationSec: 12, policy: "match_longest_media" }).durationSec,
    12
  );
  const failPlan = resolveExportDuration({
    timelineDurationSec: 5,
    audioDurationSec: 12,
    policy: "fail_on_mismatch",
  });
  assert.equal(failPlan.mismatch, true);
  assert.equal(failPlan.durationSec, 5);
});

test("export worker emits a pending_render artifact under match_longest_media", () => {
  const project = projectFixture();
  const { artifact } = runExportJob({
    project,
    timelineId: "tl_requested",
    options: { audioAssetIds: ["clip_audio"], durationPolicy: "match_longest_media" },
  });
  assert.equal(artifact.status, "pending_render");
  assert.equal(artifact.url, null);
  assert.equal(artifact.durationSec, 12);
  assert.equal(artifact.renderPlan.audioDurationSec, 12);
});

test("export worker lets callers choose whether captions render", () => {
  const project = projectFixture();
  project.timeline!.showCaptions = true;

  const { artifact } = runExportJob({
    project,
    timelineId: "tl_requested",
    options: { showCaptions: false },
  });

  assert.equal(artifact.renderPlan.showCaptions, false);
});

test("export worker fails on audio/timeline mismatch when policy is fail_on_mismatch", () => {
  const project = projectFixture();
  assert.throws(
    () =>
      runExportJob({
        project,
        timelineId: "tl_requested",
        options: { audioAssetIds: ["clip_audio"], durationPolicy: "fail_on_mismatch" },
      }),
    (err: unknown) => err instanceof ApiError && err.code === "audio_timeline_mismatch"
  );
});

test("export worker fails on measured-duration mismatch under fail_on_mismatch", () => {
  // The timeline is 5s and the audio is *registered* as 5s, so the earlier
  // registered-duration check passes. But the measured duration is 12s, which
  // the render plan aligns against — the export must still be rejected instead
  // of emitting a successful artifact with a 12s render plan.
  const project = projectFixture();
  // Shrink the timeline to 5s so the registered audio duration matches it.
  project.timeline!.segments = [
    { id: "seg_1", clipId: "clip_a", sourceInSec: 0, sourceOutSec: 5, role: "hook", reason: "" },
  ];
  const audio = project.clips.find((c) => c.id === "clip_audio")!;
  audio.durationSec = 5;
  audio.measuredDurationSec = 12;

  assert.throws(
    () =>
      runExportJob({
        project,
        timelineId: "tl_requested",
        options: { audioAssetIds: ["clip_audio"], durationPolicy: "fail_on_mismatch" },
      }),
    (err: unknown) => err instanceof ApiError && err.code === "audio_timeline_mismatch"
  );
});

test("export worker rejects an unknown duration policy", () => {
  const project = projectFixture();
  // Simulates a misspelled policy arriving as raw JSON (bypassing the type).
  assert.throws(
    () =>
      runExportJob({
        project,
        timelineId: "tl_requested",
        options: { durationPolicy: "fail_on_mismtach" as any },
      }),
    (err: unknown) =>
      err instanceof ApiError && err.code === "unsupported_duration_policy"
  );
});

test("export worker rejects a non-audio asset", () => {
  const project = projectFixture();
  assert.throws(
    () =>
      runExportJob({
        project,
        timelineId: "tl_requested",
        options: { audioAssetIds: ["clip_a"] },
      }),
    (err: unknown) => err instanceof ApiError && err.code === "invalid_request"
  );
});

test("local-mode actor resolution; hosted mode is not implemented yet", () => {
  const actor = resolveActor({ authMode: "local" });
  assert.equal(actor.mode, "local");
  assert.ok(actor.workspaceId);

  assert.throws(
    () => resolveActor({ authMode: "hosted", apiKey: "sk_whatever" }),
    (err: unknown) => err instanceof ApiError && err.status === 501
  );
});

// --- Full PR6 acceptance flows: blocked on PR1–PR5 -------------------------
// These exercise the create -> ... -> MP4 loop a real external agent would run.
// Kept as todo so the suite documents the target without failing.
test.todo(
  "asset-driven project to MP4 (needs PR1 project/asset surface + PR5 render)"
);
test.todo(
  "prompt-only project to MP4 (needs PR3 composition + PR4 generation + PR5 render)"
);
test.todo(
  "hybrid project to MP4 (needs PR1–PR5: provided + generated assets, render)"
);
