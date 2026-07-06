import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { VideoBrief } from "../schemas";
import {
  addAsset,
  coerceShotPlanContent,
  createBriefVersion,
  createProject,
  deleteProject,
  ensureLocalWorkspace,
  fillProjectPosterFromFirstFrame,
  findIdempotencyRecord,
  getProject,
  listAssets,
  listProjects,
  saveIdempotencyRecord,
  setBrief,
  setProjectPoster,
  V1Asset,
} from "../store";
import {
  createOrchestratorRun,
  getOrchestratorRun,
} from "../orchestrator-store";

// store.ts now persists to Supabase Postgres instead of the .local/ JSON file.
// Exercising it needs a live PostgREST gateway (supabase-js can't talk straight
// to Postgres), so these JSON-era unit tests are skipped unless Supabase env is
// configured. The Postgres mapping/pagination/idempotency round-trips are proven
// by the dockerized pg harness in this PR (see the PR description).
const SUPABASE_CONFIGURED = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);
const dbTest: typeof test = SUPABASE_CONFIGURED ? test : (test.skip as typeof test);

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "popcornready-v1-"));
  process.env.POPCORN_READY_LOCAL_DIR = tmpDir;
});

afterEach(async () => {
  delete process.env.POPCORN_READY_LOCAL_DIR;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function brief(goal: string): VideoBrief {
  return { goal, targetLengthSec: 15, aspectRatio: "9:16" };
}

function asset(id: string, projectId: string, workspaceId: string): V1Asset {
  const now = new Date().toISOString();
  return {
    id,
    schemaVersion: "asset.v1",
    workspaceId,
    projectId,
    kind: "video",
    filename: `${id}.mp4`,
    status: "pending",
    source: { type: "remote_url", url: "https://example.com/x.mp4" },
    remoteUrl: "https://example.com/x.mp4",
    createdAt: now,
    updatedAt: now,
  };
}

function readyRemoteAsset(input: {
  projectId: string;
  workspaceId: string;
  kind: "image" | "video";
  filename: string;
  role?: string;
  graphInputs?: V1Asset["graphInputs"];
}): V1Asset {
  const now = new Date().toISOString();
  return {
    id: "",
    schemaVersion: "asset.v1",
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    kind: input.kind,
    filename: input.filename,
    status: "ready",
    role: input.role,
    source: { type: "remote_url", url: `https://example.com/${input.filename}` },
    remoteUrl: `https://example.com/${input.filename}`,
    graphInputs: input.graphInputs,
    createdAt: now,
    updatedAt: now,
  };
}

test("coerceShotPlanContent accepts marked and legacy shot plans", () => {
  const marked = coerceShotPlanContent({
    schema_version: "plan.v1",
    targetLengthSec: 15,
    style: "playful",
    aspectRatio: "9:16",
    scenes: [
      {
        id: "scene_1",
        name: "Opening",
        beats: [{ id: "beat_1", name: "Hook", durationSec: 5, intent: "Open strong" }],
      },
    ],
  });
  assert.equal(marked?.scenes[0]?.beats[0]?.id, "beat_1");

  const legacyFlat = coerceShotPlanContent({
    targetLengthSec: 15,
    style: "playful",
    aspectRatio: "9:16",
    beats: [{ name: "Hook", durationSec: 5, intent: "Open strong" }],
  });
  assert.equal(legacyFlat?.scenes[0]?.id, "scene_1");
  assert.equal(legacyFlat?.scenes[0]?.beats[0]?.id, "beat_1_Hook");
});

test("coerceShotPlanContent rejects other plan-kind payloads", () => {
  assert.equal(
    coerceShotPlanContent({
      schema_version: "visual_anchor_plan.v1",
      anchors: [],
    }),
    null
  );
  assert.equal(
    coerceShotPlanContent({
      schema_version: "composition.v1",
      timeline: [],
    }),
    null
  );
});

dbTest("createProject without brief persists and is readable", async () => {
  const ws = await ensureLocalWorkspace("A");
  const { project, briefVersion } = await createProject({
    workspaceId: ws.id,
    name: "Teaser",
  });
  assert.equal(briefVersion, null);
  assert.equal(project.brief, null);
  assert.equal(project.schemaVersion, "project.v1");
  assert.equal(project.status, "active");

  const read = await getProject("ws_a", project.id);
  assert.equal(read.name, "Teaser");
});

dbTest("createProject with brief creates an initial brief version", async () => {
  const { project, briefVersion } = await createProject({
    workspaceId: "ws_a",
    name: "Teaser",
    brief: brief("Make a teaser"),
  });
  assert.ok(briefVersion);
  assert.equal(project.currentBriefVersionId, briefVersion!.id);
  assert.equal(project.brief?.goal, "Make a teaser");
});

dbTest("getProject is scoped to its workspace", async () => {
  const { project } = await createProject({ workspaceId: "ws_a", name: "A" });
  await assert.rejects(
    () => getProject("ws_b", project.id),
    /Project not found/
  );
});

dbTest("deleteProject cancels active orchestrator runs before hiding the project", async () => {
  const { project } = await createProject({ workspaceId: "ws_a", name: "A" });
  const queued = await createOrchestratorRun({
    projectId: project.id,
    inputSummary: "Queued",
    status: "queued",
  });
  const running = await createOrchestratorRun({
    projectId: project.id,
    inputSummary: "Running",
    status: "running",
  });
  const waiting = await createOrchestratorRun({
    projectId: project.id,
    inputSummary: "Waiting",
    status: "waiting",
  });
  const succeeded = await createOrchestratorRun({
    projectId: project.id,
    inputSummary: "Done",
    status: "succeeded",
  });

  await deleteProject("ws_a", project.id);

  await assert.rejects(() => getProject("ws_a", project.id), /Project not found/);
  for (const run of [queued, running, waiting]) {
    const after = await getOrchestratorRun(run.id);
    assert.equal(after.status, "canceled");
    assert.ok(after.completedAt);
  }
  assert.equal((await getOrchestratorRun(succeeded.id)).status, "succeeded");
});

dbTest("setBrief and createBriefVersion update the project", async () => {
  const { project } = await createProject({ workspaceId: "ws_a", name: "A" });
  await setBrief("ws_a", project.id, brief("v0"));
  const afterSet = await getProject("ws_a", project.id);
  assert.equal(afterSet.brief?.goal, "v0");

  const { project: afterVersion, briefVersion } = await createBriefVersion(
    "ws_a",
    project.id,
    brief("v1")
  );
  assert.equal(afterVersion.brief?.goal, "v1");
  assert.equal(afterVersion.currentBriefVersionId, briefVersion.id);
});

dbTest("listProjects only returns the requested workspace, newest first", async () => {
  const first = await createProject({ workspaceId: "ws_a", name: "first" });
  // Ensure distinct createdAt ordering.
  await new Promise((r) => setTimeout(r, 5));
  const second = await createProject({ workspaceId: "ws_a", name: "second" });
  await createProject({ workspaceId: "ws_other", name: "other" });

  const { items } = await listProjects("ws_a", 50, null);
  assert.deepEqual(
    items.map((p) => p.id),
    [second.project.id, first.project.id]
  );
});

dbTest("listProjects paginates with a cursor", async () => {
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const { project } = await createProject({ workspaceId: "ws_a", name: `p${i}` });
    ids.push(project.id);
    await new Promise((r) => setTimeout(r, 2));
  }
  const page1 = await listProjects("ws_a", 2, null);
  assert.equal(page1.items.length, 2);
  assert.ok(page1.nextCursor);

  const page2 = await listProjects("ws_a", 2, page1.nextCursor);
  assert.equal(page2.items.length, 1);
  assert.equal(page2.nextCursor, null);

  const seen = [...page1.items, ...page2.items].map((p) => p.id).sort();
  assert.deepEqual(seen, [...ids].sort());
});

dbTest("fillProjectPosterFromFirstFrame selects an empty poster slot", async () => {
  const { project } = await createProject({ workspaceId: "ws_a", name: "upload-first" });
  const video = await addAsset(
    readyRemoteAsset({
      projectId: project.id,
      workspaceId: "ws_a",
      kind: "video",
      filename: "source.mp4",
    })
  );
  const firstFrame = await addAsset(
    readyRemoteAsset({
      projectId: project.id,
      workspaceId: "ws_a",
      kind: "image",
      filename: "source-first-frame.png",
      role: "first_frame",
      graphInputs: [
        { assetId: video.id, relation: "input", role: "first_frame_of" },
      ],
    })
  );

  const result = await fillProjectPosterFromFirstFrame({
    workspaceId: "ws_a",
    projectId: project.id,
    assetId: firstFrame.id,
  });

  assert.equal(result.selected, true);
  assert.equal(result.project.posterAssetId, firstFrame.id);
});

dbTest("fillProjectPosterFromFirstFrame leaves a non-empty poster slot untouched", async () => {
  const { project } = await createProject({ workspaceId: "ws_a", name: "has-poster" });
  const existingPoster = await addAsset(
    readyRemoteAsset({
      projectId: project.id,
      workspaceId: "ws_a",
      kind: "image",
      filename: "ai-poster.png",
      role: "poster",
    })
  );
  await setProjectPoster("ws_a", project.id, existingPoster.id);

  const video = await addAsset(
    readyRemoteAsset({
      projectId: project.id,
      workspaceId: "ws_a",
      kind: "video",
      filename: "later-source.mp4",
    })
  );
  const firstFrame = await addAsset(
    readyRemoteAsset({
      projectId: project.id,
      workspaceId: "ws_a",
      kind: "image",
      filename: "later-source-first-frame.png",
      role: "first_frame",
      graphInputs: [
        { assetId: video.id, relation: "input", role: "first_frame_of" },
      ],
    })
  );

  const result = await fillProjectPosterFromFirstFrame({
    workspaceId: "ws_a",
    projectId: project.id,
    assetId: firstFrame.id,
  });

  assert.equal(result.selected, false);
  assert.equal(result.project.posterAssetId, existingPoster.id);
});

dbTest("fillProjectPosterFromFirstFrame lets exactly one concurrent finisher win", async () => {
  const { project } = await createProject({ workspaceId: "ws_a", name: "race" });
  const videoA = await addAsset(
    readyRemoteAsset({
      projectId: project.id,
      workspaceId: "ws_a",
      kind: "video",
      filename: "a.mp4",
    })
  );
  const videoB = await addAsset(
    readyRemoteAsset({
      projectId: project.id,
      workspaceId: "ws_a",
      kind: "video",
      filename: "b.mp4",
    })
  );
  const frameA = await addAsset(
    readyRemoteAsset({
      projectId: project.id,
      workspaceId: "ws_a",
      kind: "image",
      filename: "a-first-frame.png",
      role: "first_frame",
      graphInputs: [
        { assetId: videoA.id, relation: "input", role: "first_frame_of" },
      ],
    })
  );
  const frameB = await addAsset(
    readyRemoteAsset({
      projectId: project.id,
      workspaceId: "ws_a",
      kind: "image",
      filename: "b-first-frame.png",
      role: "first_frame",
      graphInputs: [
        { assetId: videoB.id, relation: "input", role: "first_frame_of" },
      ],
    })
  );

  const results = await Promise.all([
    fillProjectPosterFromFirstFrame({
      workspaceId: "ws_a",
      projectId: project.id,
      assetId: frameA.id,
    }),
    fillProjectPosterFromFirstFrame({
      workspaceId: "ws_a",
      projectId: project.id,
      assetId: frameB.id,
    }),
  ]);
  const selected = results.filter((result) => result.selected);
  const after = await getProject("ws_a", project.id);

  assert.equal(selected.length, 1);
  assert.ok([frameA.id, frameB.id].includes(after.posterAssetId ?? ""));
});

dbTest("assets are listed only within their project", async () => {
  await addAsset(asset("asset_1", "proj_a", "ws_a"));
  await addAsset(asset("asset_2", "proj_a", "ws_a"));
  await addAsset(asset("asset_3", "proj_b", "ws_a"));
  await createProject({ workspaceId: "ws_a", name: "ignored" });

  // listAssets requires the project to exist; create it explicitly.
  const { project } = await createProject({ workspaceId: "ws_a", name: "host" });
  await addAsset(asset("asset_4", project.id, "ws_a"));
  const { items } = await listAssets("ws_a", project.id, 50, null);
  assert.deepEqual(
    items.map((a) => a.id),
    ["asset_4"]
  );
});

dbTest("idempotency records persist and are found by scope+key", async () => {
  const found0 = await findIdempotencyRecord("scope", "key1");
  assert.equal(found0, undefined);

  await saveIdempotencyRecord({
    scope: "scope",
    key: "key1",
    bodyHash: "abc",
    status: 201,
    responseBody: { project: { id: "proj_1" } },
    createdAt: new Date().toISOString(),
  });

  const found = await findIdempotencyRecord("scope", "key1");
  assert.ok(found);
  assert.equal(found!.bodyHash, "abc");
  assert.equal(found!.status, 201);

  // Saving the same scope+key again does not duplicate.
  await saveIdempotencyRecord({
    scope: "scope",
    key: "key1",
    bodyHash: "abc",
    status: 201,
    responseBody: {},
    createdAt: new Date().toISOString(),
  });
  const again = await findIdempotencyRecord("scope", "key1");
  assert.equal(again!.responseBody && (again!.responseBody as any).project.id, "proj_1");
});
