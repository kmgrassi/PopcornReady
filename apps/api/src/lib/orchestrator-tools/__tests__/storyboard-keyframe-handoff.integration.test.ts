import assert from "node:assert/strict";
import test from "node:test";

import {
  addProjectBrief,
  addProjectPlan,
  getActiveProjectBrief,
  getActiveProjectPlan,
  getProjectStoryboard,
  getProjectStoryboardsForPlan,
} from "@/lib/api/v1/store";
import { createStoryboard } from "@/lib/api/v1/storyboards";
import {
  createTestSandbox,
  teardownTestSandbox,
} from "@/lib/test-sandboxes/sandbox";
import type { ShotPlan } from "@popcorn/shared/types";
import { createGenerateKeyframeTool } from "../generate-keyframe";
import { runStoryboardJob } from "../storyboard-job";

const localUrl = process.env.SUPABASE_URL ?? "";
const runLocalIntegration =
  process.env.RUN_LOCAL_DB_INTEGRATION === "1" &&
  /127\.0\.0\.1|localhost/.test(localUrl) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
const integrationTest = runLocalIntegration ? test : test.skip;

const PREFIX = "__storyboard_handoff_test__";

integrationTest(
  "storyboard worker persists a plan-bound handoff that keyframes can resolve after the current pointer moves",
  async () => {
    const sandbox = await createTestSandbox({
      prefix: PREFIX,
      purpose: "storyboard-keyframe-handoff",
      projectName: "storyboard keyframe handoff",
    });
    const previousProvider = process.env.STORYBOARD_TILE_PROVIDER;
    process.env.STORYBOARD_TILE_PROVIDER = "mock";

    try {
      const plan: ShotPlan = {
        targetLengthSec: 10,
        style: "cinematic",
        aspectRatio: "16:9",
        scenes: [
          {
            id: "scene_1",
            name: "Popcorn reveal",
            beats: [
              { id: "beat_1", name: "Burst", durationSec: 5, intent: "Popcorn bursts." },
              { id: "beat_2", name: "Reel", durationSec: 5, intent: "A film reel glows." },
            ],
          },
        ],
      };
      await addProjectBrief({
        workspaceId: sandbox.workspaceId,
        projectId: sandbox.projectId,
        brief: {
          goal: "Create a ten-second Popcorn Ready teaser.",
          targetLengthSec: 10,
          aspectRatio: "16:9",
          style: "cinematic",
        },
      });
      const brief = await getActiveProjectBrief(sandbox.projectId);
      const { planAssetId } = await addProjectPlan({
        workspaceId: sandbox.workspaceId,
        projectId: sandbox.projectId,
        ...(brief ? { briefAssetId: brief.assetId, briefContentHash: brief.contentHash } : {}),
        plan,
      });
      const activePlan = await getActiveProjectPlan(sandbox.projectId);
      assert.ok(activePlan);

      let succeededResult: unknown;
      await runStoryboardJob(
        {
          jobId: "storyboard_job",
          workspaceId: sandbox.workspaceId,
          projectId: sandbox.projectId,
          plan,
          planAssetId,
          planContentHash: activePlan.contentHash,
        },
        {
          // Simulate a complete pre-marker production storyboard.
          markStoryboardHandoffReady: async () => {},
          jobs: {
            async setStep() {
              return {} as never;
            },
            async succeed(_jobId, result) {
              succeededResult = result;
              return {} as never;
            },
            async fail(_jobId, error) {
              throw new Error(`Storyboard worker failed: ${JSON.stringify(error)}`);
            },
          },
        }
      );
      assert.equal(
        (succeededResult as { assetIds?: string[] } | undefined)?.assetIds?.length,
        2
      );

      await createStoryboard({
        auth: {
          mode: "local",
          actor: { id: "integration_test", type: "local" },
          workspaceId: sandbox.workspaceId,
          isLocal: true,
        },
        projectId: sandbox.projectId,
        data: { planAssetId, status: "ready" },
      });

      const unrelatedCurrent = await createStoryboard({
        auth: {
          mode: "local",
          actor: { id: "integration_test", type: "local" },
          workspaceId: sandbox.workspaceId,
          isLocal: true,
        },
        projectId: sandbox.projectId,
        data: { planAssetId: null, status: "ready" },
      });

      const planStoryboards = await getProjectStoryboardsForPlan(
        sandbox.workspaceId,
        sandbox.projectId,
        planAssetId
      );
      assert.equal(planStoryboards.length, 2);
      const completeStoryboard = planStoryboards.find(
        (candidate) => candidate.scenes[0]?.beats.length === 2
      );
      assert.ok(completeStoryboard);
      assert.equal(completeStoryboard.planAssetId, planAssetId);
      assert.equal(completeStoryboard.scenes[0].beats.length, 2);
      assert.equal(
        completeStoryboard.scenes[0].beats.filter((beat) =>
          beat.panels.some((panel) => panel.isSelected && panel.imageAssetId)
        ).length,
        2
      );

      let kickedStoryboardId: string | undefined;
      const tool = createGenerateKeyframeTool({
        createJob: async () => ({
          job: {
            id: "keyframe_job",
            type: "asset_generation",
            status: "queued",
            projectId: sandbox.projectId,
            createdAt: "t",
            updatedAt: "t",
          },
          created: true,
        }),
        runGenerateKeyframeJob: async (input) => {
          kickedStoryboardId = input.storyboard.id;
        },
      });
      const result = await tool.execute(
        { provider: "mock" },
        {
          auth: {
            mode: "local",
            actor: { id: "integration_test", type: "local" },
            workspaceId: sandbox.workspaceId,
            isLocal: true,
          },
          projectId: sandbox.projectId,
        }
      );
      assert.equal(result.status, "accepted");
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(kickedStoryboardId, completeStoryboard.id);

      let failedAfterBuild = false;
      await runStoryboardJob(
        {
          jobId: "storyboard_job_failed_after_build",
          workspaceId: sandbox.workspaceId,
          projectId: sandbox.projectId,
          plan,
          planAssetId,
          planContentHash: activePlan.contentHash,
        },
        {
          getProjectStoryboardById: async () => null,
          jobs: {
            async setStep() {
              return {} as never;
            },
            async succeed() {
              throw new Error("an unverified storyboard must not succeed");
            },
            async fail() {
              failedAfterBuild = true;
              return {} as never;
            },
          },
        }
      );
      assert.equal(failedAfterBuild, true);
      const currentAfterFailure = await getProjectStoryboard(
        sandbox.workspaceId,
        sandbox.projectId
      );
      assert.equal(currentAfterFailure?.id, unrelatedCurrent.id);
      const publishedPlanStoryboards = await getProjectStoryboardsForPlan(
        sandbox.workspaceId,
        sandbox.projectId,
        planAssetId
      );
      assert.ok(
        publishedPlanStoryboards.some((candidate) => candidate.id === completeStoryboard.id)
      );
    } finally {
      if (previousProvider === undefined) delete process.env.STORYBOARD_TILE_PROVIDER;
      else process.env.STORYBOARD_TILE_PROVIDER = previousProvider;
      await teardownTestSandbox({
        ...sandbox,
        prefix: PREFIX,
        purpose: "storyboard-keyframe-handoff",
      });
    }
  }
);
