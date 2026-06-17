import assert from "node:assert/strict";
import test from "node:test";

import type { AuthContext } from "@/lib/api/v1/auth";
import type { GeneratePosterResult } from "@/lib/api/v1/poster-generation";
import { createGeneratePosterTool } from "../generate-poster";
import { runGeneratePosterJob } from "../generate-poster-job";
import { ToolInputError } from "../types";
import type { ToolCallResult } from "../types";

const auth: AuthContext = {
  mode: "local",
  actor: { id: "local_dev", type: "local" },
  workspaceId: "ws_1",
  isLocal: true,
};

function posterContext(hasBrief: boolean) {
  return {
    project: {} as never,
    briefAsset: hasBrief ? { id: "brief_1", contentHash: "brief_hash" } : null,
    planAsset: null,
    heroAnchorAsset: null,
    currentPosterManuallyPinned: false,
  };
}

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
    },
  };
}

test("generate_poster requires a brief", async () => {
  const tool = createGeneratePosterTool({
    getPosterGenerationContext: async () => posterContext(false),
    createJob: async () => {
      throw new Error("must not create a job without a brief");
    },
    runGeneratePosterJob: async () => {},
  });

  const result = (await tool.execute({}, { auth, projectId: "proj_1" })) as ToolCallResult;
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.error.kind, "precondition_unmet");
    assert.equal(result.error.unmetRequirements?.[0]?.satisfyWith.tool, "create_or_load_brief");
  }
});

test("generate_poster accepts and kicks off the worker with active brief", async () => {
  let kicked:
    | {
        jobId: string;
        workspaceId: string;
        projectId: string;
        orchestratorRunId?: string;
        provider?: string;
        force?: boolean;
      }
    | undefined;
  const tool = createGeneratePosterTool({
    getPosterGenerationContext: async () => posterContext(true),
    createJob: async () => queuedJob(),
    runGeneratePosterJob: async (input) => {
      kicked = input;
    },
  });

  const result = (await tool.execute(
    { provider: "mock", force: true },
    { auth, projectId: "proj_1", orchestratorRunId: "run_1" }
  )) as ToolCallResult;

  assert.equal(result.status, "accepted");
  if (result.status === "accepted") {
    assert.equal(result.jobId, "job_1");
    assert.equal(result.resumesWhen, "job_terminal");
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(kicked?.jobId, "job_1");
  assert.equal(kicked?.workspaceId, "ws_1");
  assert.equal(kicked?.projectId, "proj_1");
  assert.equal(kicked?.orchestratorRunId, "run_1");
  assert.equal(kicked?.provider, "mock");
  assert.equal(kicked?.force, true);
});

test("generate_poster validates input before reading graph state", async () => {
  let reads = 0;
  const tool = createGeneratePosterTool({
    getPosterGenerationContext: async () => {
      reads += 1;
      return posterContext(true);
    },
    createJob: async () => queuedJob(),
    runGeneratePosterJob: async () => {},
  });

  assert.throws(() => tool.parseInput({ provider: "banana" }), ToolInputError);
  assert.equal(reads, 0);
});

test("runGeneratePosterJob marks generated posters as succeeded and resumes", async () => {
  const spy = jobsSpy();
  let resumedRun: string | undefined;
  const result: GeneratePosterResult = {
    project: {} as never,
    poster: {
      assetId: "poster_1",
      generated: true,
      reused: false,
      selected: true,
      manuallyPinned: false,
    },
  };

  await runGeneratePosterJob(
    {
      jobId: "job_1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      orchestratorRunId: "run_1",
      provider: "mock",
    },
    {
      jobs: spy.jobs,
      generatePoster: async (_auth, _projectId, input) => {
        assert.equal(input?.provider, "mock");
        return result;
      },
      resumeOrchestratorRun: async (runId) => {
        resumedRun = runId;
      },
    }
  );

  assert.deepEqual(spy.calls, ["setStep", "succeed"]);
  assert.deepEqual(spy.succeededResult, {
    status: "succeeded",
    assetIds: ["poster_1"],
    reused: false,
    selected: true,
    manuallyPinned: false,
  });
  assert.equal(resumedRun, "run_1");
});

test("runGeneratePosterJob soft-fails poster errors so the run can continue", async () => {
  const spy = jobsSpy();
  let resumedRun: string | undefined;

  await runGeneratePosterJob(
    {
      jobId: "job_1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      orchestratorRunId: "run_1",
    },
    {
      jobs: spy.jobs,
      generatePoster: async () => {
        throw new Error("provider unavailable");
      },
      resumeOrchestratorRun: async (runId) => {
        resumedRun = runId;
      },
    }
  );

  assert.deepEqual(spy.calls, ["setStep", "succeed"]);
  assert.deepEqual(spy.succeededResult, {
    status: "failed",
    assetIds: [],
    error: { code: "poster_generation_failed", message: "provider unavailable" },
  });
  assert.equal(resumedRun, "run_1");
});
