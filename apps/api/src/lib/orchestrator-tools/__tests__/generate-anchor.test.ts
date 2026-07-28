import assert from "node:assert/strict";
import test from "node:test";

import type { AuthContext } from "@/lib/api/v1/auth";
import type { VisualAnchorPlan } from "@/lib/api/v1/store";
import { createGenerateAnchorTool } from "../generate-anchor";
import { runGenerateAnchorJob } from "../generate-anchor-job";
import { ToolInputError } from "../types";
import type { ToolCallResult } from "../types";

const auth: AuthContext = {
  mode: "local",
  actor: { id: "local_dev", type: "local" },
  workspaceId: "ws_1",
  isLocal: true,
};

const visualAnchorPlan: VisualAnchorPlan = {
  schemaVersion: "visual_anchor_plan.v1",
  anchors: [
    {
      id: "character_maya",
      kind: "character",
      label: "Maya",
      description: "Lead barista in a red apron.",
      sourceSceneIds: ["scene_1"],
      sourceBeatIds: ["beat_1"],
    },
    {
      id: "location_cafe",
      kind: "location",
      label: "Sunny cafe",
      description: "Warm neighborhood cafe at morning rush.",
      sourceSceneIds: ["scene_1"],
      sourceBeatIds: ["beat_1"],
    },
  ],
};

const activePlan = {
  visualAnchorPlan,
  assetId: "vap_1",
  contentHash: "vap_hash",
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

test("generate_anchor requires a visual anchor plan", async () => {
  const tool = createGenerateAnchorTool({
    getActiveProjectVisualAnchorPlan: async () => null,
    createJob: async () => {
      throw new Error("must not create a job without a visual anchor plan");
    },
    runGenerateAnchorJob: async () => {},
  });

  const result = (await tool.execute({}, { auth, projectId: "proj_1" })) as ToolCallResult;
  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.error.kind, "precondition_unmet");
    assert.equal(result.error.unmetRequirements?.[0]?.satisfyWith.tool, "plan_visual_anchors");
  }
});

test("generate_anchor accepts and kicks off the worker with the active visual anchor plan", async () => {
  let kicked:
    | {
        jobId: string;
        orchestratorRunId?: string;
        visualAnchorPlanAssetId: string;
        provider?: string;
      }
    | undefined;
  const tool = createGenerateAnchorTool({
    getActiveProjectVisualAnchorPlan: async () => activePlan,
    createJob: async () => queuedJob(),
    runGenerateAnchorJob: async (input) => {
      kicked = input;
    },
  });

  const result = (await tool.execute(
    { provider: "mock" },
    { auth, projectId: "proj_1", orchestratorRunId: "run_1" }
  )) as ToolCallResult;

  assert.equal(result.status, "accepted");
  if (result.status === "accepted") {
    assert.equal(result.jobId, "job_1");
    assert.equal(result.resumesWhen, "job_terminal");
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(kicked?.jobId, "job_1");
  assert.equal(kicked?.orchestratorRunId, "run_1");
  assert.equal(kicked?.visualAnchorPlanAssetId, "vap_1");
  assert.equal(kicked?.provider, "mock");
});

test("generate_anchor omits provider so workspace settings can resolve it", async () => {
  let kicked: { provider?: string } | undefined;
  const tool = createGenerateAnchorTool({
    getActiveProjectVisualAnchorPlan: async () => activePlan,
    createJob: async () => queuedJob(),
    runGenerateAnchorJob: async (input) => {
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

test("generate_anchor validates input before reading the plan", async () => {
  let planReads = 0;
  const tool = createGenerateAnchorTool({
    getActiveProjectVisualAnchorPlan: async () => {
      planReads += 1;
      return activePlan;
    },
    createJob: async () => queuedJob(),
    runGenerateAnchorJob: async () => {},
  });

  assert.throws(() => tool.parseInput({ provider: "banana" }), ToolInputError);
  assert.equal(planReads, 0);
});

test("runGenerateAnchorJob generates character and scene anchors, stamps graph metadata, and resumes", async () => {
  const spy = jobsSpy();
  const generatedCalls: Array<{ kind: "character" | "scene"; provider?: string }> = [];
  const selected: Array<{ assetId: string; role: string; anchorId: string }> = [];
  const graphRoles: string[] = [];
  let resumedRun: string | undefined;

  await runGenerateAnchorJob(
    {
      jobId: "job_1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      orchestratorRunId: "run_1",
      visualAnchorPlan,
      visualAnchorPlanAssetId: "vap_1",
      visualAnchorPlanContentHash: "vap_hash",
      provider: "mock",
    },
    {
      jobs: spy.jobs,
      generateCharacterAnchor: async (args) => {
        graphRoles.push((args.body as { assetRole?: string }).assetRole ?? "");
        generatedCalls.push({
          kind: "character",
          provider: (args.body as { provider?: string }).provider,
        });
        return {
          status: 202,
          body: { job: { result: { assetIds: ["char_anchor_asset"] } } },
        };
      },
      createGeneratedAsset: async (args) => {
        graphRoles.push((args.body as { assetRole?: string }).assetRole ?? "");
        generatedCalls.push({
          kind: "scene",
          provider: (args.body as { provider?: string }).provider,
        });
        return {
          status: 202,
          body: { job: { result: { assetIds: ["scene_anchor_asset"] } } },
        };
      },
      selectGeneratedAnchorAsset: async (input) => {
        selected.push({
          assetId: input.assetId,
          role: input.role,
          anchorId: input.anchorId,
        });
        return {} as never;
      },
      enqueueOrchestratorDispatch: async (runId) => {
        resumedRun = runId;
      },
    }
  );

  assert.deepEqual(generatedCalls, [
    { kind: "character", provider: "mock" },
    { kind: "scene", provider: "mock" },
  ]);
  assert.deepEqual(graphRoles, ["character_anchor", "scene_anchor"]);
  assert.deepEqual(selected, [
    { assetId: "char_anchor_asset", role: "character_anchor", anchorId: "character_maya" },
    { assetId: "scene_anchor_asset", role: "scene_anchor", anchorId: "location_cafe" },
  ]);
  assert.deepEqual(spy.succeededResult, {
    assetIds: ["char_anchor_asset", "scene_anchor_asset"],
  });
  assert.equal(resumedRun, "run_1");
  assert.ok(!spy.calls.includes("fail"));
});

test("domain anchor completion stays pooled and cannot overwrite a newer selection", async () => {
  const spy = jobsSpy();
  const claims: Array<number | undefined> = [];
  let selectionAttempts = 0;

  await runGenerateAnchorJob(
    {
      jobId: "job_domain",
      workspaceId: "ws_1",
      projectId: "proj_1",
      orchestratorRunId: "run_domain",
      sessionClaimGeneration: 7,
      visualAnchorPlan,
      visualAnchorPlanAssetId: "vap_1",
      visualAnchorPlanContentHash: "vap_hash",
      provider: "mock",
    },
    {
      jobs: spy.jobs,
      generateCharacterAnchor: async (args) => {
        claims.push(args.sessionClaimGeneration);
        return {
          status: 202,
          body: { job: { result: { assetIds: ["char_anchor_domain"] } } },
        };
      },
      createGeneratedAsset: async (args) => {
        claims.push(args.sessionClaimGeneration);
        return {
          status: 202,
          body: { job: { result: { assetIds: ["scene_anchor_domain"] } } },
        };
      },
      selectGeneratedAnchorAsset: async () => {
        selectionAttempts += 1;
        throw new Error("domain jobs must not append selections");
      },
      enqueueOrchestratorDispatch: async () => {},
    }
  );

  assert.deepEqual(claims, [7, 7]);
  assert.equal(selectionAttempts, 0);
  assert.deepEqual(spy.succeededResult, {
    assetIds: ["char_anchor_domain", "scene_anchor_domain"],
  });
});

test("runGenerateAnchorJob routes anchors mentioning minors to Gemini by default", async () => {
  const spy = jobsSpy();
  let provider: string | undefined;

  await runGenerateAnchorJob(
    {
      jobId: "job_1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      visualAnchorPlan: {
        schemaVersion: "visual_anchor_plan.v1",
        anchors: [
          {
            id: "character_child",
            kind: "character",
            label: "young girl protagonist",
            description: "A child hero in a school uniform.",
            sourceSceneIds: ["scene_1"],
            sourceBeatIds: ["beat_1"],
          },
        ],
      },
      visualAnchorPlanAssetId: "vap_1",
      visualAnchorPlanContentHash: "vap_hash",
    },
    {
      jobs: spy.jobs,
      generateCharacterAnchor: async (args) => {
        provider = (args.body as { provider?: string }).provider;
        return {
          status: 202,
          body: { job: { result: { assetIds: ["char_anchor_asset"] } } },
        };
      },
      selectGeneratedAnchorAsset: async () => ({} as never),
    }
  );

  assert.equal(provider, "gemini");
  assert.ok(!spy.calls.includes("fail"));
});

test("runGenerateAnchorJob keeps minor anchors on Gemini even when provider is overridden", async () => {
  const spy = jobsSpy();
  let provider: string | undefined;

  await runGenerateAnchorJob(
    {
      jobId: "job_1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      provider: "openai",
      visualAnchorPlan: {
        schemaVersion: "visual_anchor_plan.v1",
        anchors: [
          {
            id: "character_teen",
            kind: "character",
            label: "teen protagonist",
            description: "A teenage lead character.",
            sourceSceneIds: ["scene_1"],
            sourceBeatIds: ["beat_1"],
          },
        ],
      },
      visualAnchorPlanAssetId: "vap_1",
      visualAnchorPlanContentHash: "vap_hash",
    },
    {
      jobs: spy.jobs,
      generateCharacterAnchor: async (args) => {
        provider = (args.body as { provider?: string }).provider;
        return {
          status: 202,
          body: { job: { result: { assetIds: ["char_anchor_asset"] } } },
        };
      },
      selectGeneratedAnchorAsset: async () => ({} as never),
    }
  );

  assert.equal(provider, "gemini");
  assert.ok(!spy.calls.includes("fail"));
});
