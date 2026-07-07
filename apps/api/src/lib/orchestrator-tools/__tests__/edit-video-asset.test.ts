import assert from "node:assert/strict";
import test from "node:test";

import type { AuthContext } from "@/lib/api/v1/auth";
import type { V1Asset } from "@/lib/api/v1/store";
import {
  createEditVideoAssetTool,
  parseEditVideoAssetInput,
} from "../edit-video-asset";
import { runEditVideoAssetJob } from "../edit-video-asset-job";
import { ToolInputError, type ToolCallResult } from "../types";

const auth: AuthContext = {
  mode: "local",
  actor: { id: "local_dev", type: "local" },
  workspaceId: "ws_1",
  isLocal: true,
};

function asset(overrides: Partial<V1Asset> = {}): V1Asset {
  return {
    id: overrides.id ?? "source_1",
    schemaVersion: "asset.v1",
    workspaceId: "ws_1",
    projectId: "proj_1",
    kind: overrides.kind ?? "video",
    role: overrides.role ?? "beat_clip",
    filename: overrides.filename ?? "source.mp4",
    status: overrides.status ?? "ready",
    source: overrides.source ?? { type: "generated", generatedAssetId: "source_1" },
    storageKey: overrides.storageKey ?? "assets/source.mp4",
    durationSec: overrides.durationSec ?? 6,
    contentHash: overrides.contentHash ?? "source_hash",
    createdAt: "t",
    updatedAt: "t",
  };
}

function queuedJob(created = true) {
  return {
    job: {
      id: "job_1",
      type: "asset_generation" as const,
      status: "queued" as const,
      projectId: "proj_1",
      createdAt: "t",
      updatedAt: "t",
    },
    created,
  };
}

function jobsSpy() {
  const calls: string[] = [];
  let succeededResult: unknown;
  let failedError: unknown;
  return {
    calls,
    get succeededResult() {
      return succeededResult;
    },
    get failedError() {
      return failedError;
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
      async fail(_id: string, error: unknown) {
        calls.push("fail");
        failedError = error;
        return {} as never;
      },
    },
  };
}

test("edit_video_asset validates required fields and rejects unsupported input", () => {
  assert.throws(() => parseEditVideoAssetInput({ instruction: "add a lamp" }), ToolInputError);
  assert.throws(() => parseEditVideoAssetInput({ sourceAssetId: "a", instruction: "" }), ToolInputError);
  assert.throws(
    () => parseEditVideoAssetInput({ sourceAssetId: "a", instruction: "x", temperature: 1 }),
    ToolInputError
  );
  assert.deepEqual(
    parseEditVideoAssetInput({
      sourceAssetId: " source_1 ",
      instruction: " Add a dinosaur. ",
      beatId: " beat_1 ",
      provider: "mock",
    }),
    {
      sourceAssetId: "source_1",
      instruction: "Add a dinosaur.",
      beatId: "beat_1",
      provider: "mock",
    }
  );
});

test("edit_video_asset requires a ready video source with stored bytes", async () => {
  const tool = createEditVideoAssetTool({
    getAsset: async () => asset({ status: "pending", storageKey: undefined }),
    createJob: async () => {
      throw new Error("must not create a job");
    },
    runEditVideoAssetJob: async () => {},
  });

  const result = (await tool.execute(
    { sourceAssetId: "source_1", instruction: "add a lamp" },
    { auth, projectId: "proj_1" }
  )) as ToolCallResult;

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.error.kind, "precondition_unmet");
    assert.equal(result.error.unmetRequirements?.[0]?.satisfyWith.tool, "edit_video_asset");
  }
});

test("edit_video_asset creates a deterministic idempotent job and kicks the worker once", async () => {
  const idempotencyKeys: string[] = [];
  let kicked:
    | {
        sourceAssetId: string;
        instruction: string;
        beatId?: string;
        provider: string;
        model: string;
      }
    | undefined;

  const tool = createEditVideoAssetTool({
    getAsset: async () => asset(),
    createJob: async (input) => {
      idempotencyKeys.push(input.idempotencyKey ?? "");
      return queuedJob(idempotencyKeys.length === 1);
    },
    runEditVideoAssetJob: async (input) => {
      kicked = input;
    },
  });

  const input = {
    sourceAssetId: "source_1",
    instruction: " Add a dinosaur sitting on the couch. ",
    beatId: "beat_1",
    provider: "mock" as const,
  };
  const result = await tool.execute(input, {
    auth,
    projectId: "proj_1",
    orchestratorRunId: "run_1",
  });
  const replay = await tool.execute(
    { ...input, instruction: "add   a dinosaur sitting on the couch." },
    { auth, projectId: "proj_1", orchestratorRunId: "run_1" }
  );

  assert.equal(result.status, "accepted");
  assert.equal(replay.status, "accepted");
  assert.equal(idempotencyKeys[0], idempotencyKeys[1]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(kicked?.sourceAssetId, "source_1");
  assert.equal(kicked?.beatId, "beat_1");
  assert.equal(kicked?.provider, "mock");
});

test("edit_video_asset idempotency separates provider and beat targets", async () => {
  const keys: string[] = [];
  const tool = createEditVideoAssetTool({
    getAsset: async () => asset(),
    createJob: async (input) => {
      keys.push(input.idempotencyKey ?? "");
      return queuedJob(false);
    },
    runEditVideoAssetJob: async () => {},
  });

  await tool.execute(
    {
      sourceAssetId: "source_1",
      instruction: "Add a dinosaur.",
      provider: "mock",
      beatId: "beat_1",
    },
    { auth, projectId: "proj_1" }
  );
  await tool.execute(
    {
      sourceAssetId: "source_1",
      instruction: "Add a dinosaur.",
      provider: "gemini",
      beatId: "beat_1",
    },
    { auth, projectId: "proj_1" }
  );
  await tool.execute(
    {
      sourceAssetId: "source_1",
      instruction: "Add a dinosaur.",
      provider: "mock",
      beatId: "beat_2",
    },
    { auth, projectId: "proj_1" }
  );

  assert.equal(new Set(keys).size, 3);
});

test("runEditVideoAssetJob passes edit provenance fields, selects beat clips, and resumes", async () => {
  const spy = jobsSpy();
  const generatedBodies: Record<string, unknown>[] = [];
  const selected: Array<{ assetId: string; beatId: string }> = [];
  let resumedRun: string | undefined;

  await runEditVideoAssetJob(
    {
      jobId: "job_1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      orchestratorRunId: "run_1",
      sourceAssetId: "source_1",
      sourceContentHash: "source_hash",
      sourceDurationSec: 6,
      sourceRole: "beat_clip",
      instruction: "Add a dinosaur sitting on the couch.",
      beatId: "beat_1",
      provider: "mock",
      model: "mock-video-edit",
    },
    {
      jobs: spy.jobs,
      createGeneratedAsset: async (args) => {
        generatedBodies.push(args.body as Record<string, unknown>);
        return {
          status: 202,
          body: { job: { result: { assetIds: ["edited_1"] } } },
        };
      },
      selectGeneratedBeatClipAsset: async (input) => {
        selected.push({ assetId: input.assetId, beatId: input.beatId });
        return {} as never;
      },
      resumeOrchestratorRun: async (runId) => {
        resumedRun = runId;
      },
    }
  );

  assert.equal(generatedBodies[0]?.editSourceAssetId, "source_1");
  assert.equal(generatedBodies[0]?.referenceAssetIds, undefined);
  assert.deepEqual(generatedBodies[0]?.graphInputs, [
    {
      assetId: "source_1",
      relation: "input",
      role: "edited_from",
      position: 0,
      contentHash: "source_hash",
    },
  ]);
  assert.equal(generatedBodies[0]?.assetRole, "beat_clip");
  assert.deepEqual(selected, [{ assetId: "edited_1", beatId: "beat_1" }]);
  assert.deepEqual(spy.succeededResult, {
    assetIds: ["edited_1"],
    sourceAssetId: "source_1",
  });
  assert.equal(resumedRun, "run_1");
  assert.ok(!spy.calls.includes("fail"));
});
