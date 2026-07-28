import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import type {
  ActionId,
  DomainTaskV1,
  OrchestratorRunId,
} from "@popcorn/shared/domain-agent-contract";

import {
  claimSessionRun,
  createDomainRun,
  releaseSessionRun,
} from "@/lib/api/v1/domain-session-store";
import { inputsFingerprint } from "@/lib/api/v1/asset-graph";
import { createAction, createJob } from "@/lib/api/v1/store";

const localUrl = process.env.SUPABASE_URL ?? "";
const runLocalIntegration =
  process.env.RUN_LOCAL_DB_INTEGRATION === "1" &&
  /127\.0\.0\.1|localhost/.test(localUrl) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
const integrationTest = runLocalIntegration ? test : test.skip;

integrationTest(
  "claimed storyboard commit is atomic across replay, claim loss, and project CAS races",
  async () => {
    const service = createClient(
      localUrl,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const rootRunId = randomUUID();
    const delegationActionId = randomUUID();
    const planAssetId = randomUUID();
    const planHash = "claimed-storyboard-plan-hash";
    await service.from("workspaces").insert({
      id: workspaceId,
      name: `__claimed_storyboard__${workspaceId}`,
    }).throwOnError();
    await service.from("projects").insert({
      id: projectId,
      workspace_id: workspaceId,
      name: "Claimed storyboard bundle",
      visibility: "private",
    }).throwOnError();
    await service.from("orchestrator_runs").insert({
      id: rootRunId,
      project_id: projectId,
      status: "running",
      input_summary: "root",
    }).throwOnError();
    await service.from("actions").insert({
      id: delegationActionId,
      project_id: projectId,
      orchestrator_run_id: rootRunId,
      tool: "delegate_visuals",
      status: "running",
    }).throwOnError();
    await service.from("assets").insert({
      id: planAssetId,
      schema_version: "asset.v1",
      workspace_id: workspaceId,
      project_id: projectId,
      kind: "plan",
      media: "data",
      status: "ready",
      role: "plan",
      filename: "plan.json",
      content: {
        schema_version: "plan.v1",
        targetLengthSec: 10,
        style: "cinematic",
        aspectRatio: "16:9",
        scenes: [{
          id: "plan-scene-1",
          name: "Scene",
          beats: [
            {
              id: "plan-beat-1",
              name: "One",
              intent: "one",
              durationSec: 5,
            },
            {
              id: "plan-beat-2",
              name: "Two",
              intent: "two",
              durationSec: 5,
            },
          ],
        }, {
          id: "plan-scene-2",
          name: "Empty scene",
          beats: [],
        }],
      },
      content_hash: planHash,
      source: {},
    }).throwOnError();
    const { data: selection } = await service.from("selections").insert({
      project_id: projectId,
      slot_owner_lineage_id: null,
      slot_role: "plan",
      active_asset_id: planAssetId,
    }).select("seq").single().throwOnError();

    const task: DomainTaskV1 = {
      schemaVersion: "DomainTask.v1",
      domain: "visuals",
      taskKind: "visuals_production",
      objective: "Storyboard the plan",
      instruction: "Generate storyboard tiles.",
      targets: [{ kind: "project", projectId }],
      requiredOutputs: [{ kind: "keyframe", role: "storyboard", minimumCount: 1 }],
      allowedOutputKinds: ["keyframe"],
      creativeConstraints: {},
      preserve: { assetIds: [], selections: [], fingerprints: [], pins: [] },
      candidateAffectedAssetIds: [],
      budgetUsd: 1,
      acceptanceCriteria: ["Complete storyboard"],
      origin: {
        kind: "creative_director",
        rootRunId: rootRunId as OrchestratorRunId,
        rootActionId: delegationActionId as ActionId,
        creatorMessageId: randomUUID(),
      },
      responseRecipient: { kind: "creative_director" },
    };
    const run = await createDomainRun({
      projectId,
      domain: "visuals",
      task,
      inputSummary: "claimed storyboard",
      origin: {
        kind: "creative_director",
        parentRunId: rootRunId,
        rootActionId: delegationActionId,
      },
    });
    const claim = await claimSessionRun({
      projectId,
      sessionId: run.agentSessionId!,
      runId: run.id,
    });
    assert.equal(claim.state, "claimed");
    const claimGeneration =
      claim.state === "claimed" ? claim.claimGeneration : -1;
    await service.from("orchestrator_runs")
      .update({ status: "running" })
      .eq("id", run.id)
      .throwOnError();

    async function invocation() {
      const actionId = randomUUID();
      await createAction({
        id: actionId,
        projectId,
        orchestratorRunId: run.id,
        tool: "generate_storyboard",
        status: "running",
        params: {},
      });
      const job = await createJob({
        workspaceId,
        projectId,
        type: "asset_generation",
        actionId,
        sessionClaimGeneration: claimGeneration,
      });
      return { actionId, jobId: job.id };
    }

    function args(input: {
      actionId: string;
      jobId: string;
      storyboardId?: string;
      expectedSeq?: number;
      expectedPointer?: string | null;
      baselineId?: string | null;
      preservation?: unknown[];
    }) {
      const storyboardId = input.storyboardId ?? randomUUID();
      const tile1 = randomUUID();
      const tile2 = randomUUID();
      const newAssets = [
        {
          id: tile1,
          filename: "beat-1.png",
          storageKey: `storyboard/${tile1}.png`,
          storageBucket: "assets-private",
          visibility: "private",
          params: {
            schema_version: "asset_params.v1",
            provenance: { provider: "mock", prompt: "one", beatId: "plan-beat-1" },
          },
          inputs: [{
            assetId: planAssetId,
            relation: "input" as const,
            role: "plan",
            position: 0,
            contentHash: planHash,
          }],
          contentHash: "tile-hash-1",
          beatId: "plan-beat-1",
        },
        {
          id: tile2,
          filename: "beat-2.png",
          storageKey: `storyboard/${tile2}.png`,
          storageBucket: "assets-private",
          visibility: "private",
          params: {
            schema_version: "asset_params.v1",
            provenance: { provider: "mock", prompt: "two", beatId: "plan-beat-2" },
          },
          inputs: [{
            assetId: planAssetId,
            relation: "input" as const,
            role: "plan",
            position: 1,
            contentHash: planHash,
          }],
          contentHash: "tile-hash-2",
          beatId: "plan-beat-2",
        },
      ].map((asset) => ({
        ...asset,
        inputsFingerprint: inputsFingerprint(asset.inputs, asset.params),
      }));
      return {
        p_workspace_id: workspaceId,
        p_project_id: projectId,
        p_job_id: input.jobId,
        p_action_id: input.actionId,
        p_run_id: run.id,
        p_session_claim_generation: claimGeneration,
        p_plan_asset_id: planAssetId,
        p_plan_content_hash: planHash,
        p_expected_plan_selection_seq: input.expectedSeq ?? selection.seq,
        p_expected_current_storyboard_id: input.expectedPointer ?? null,
        p_baseline_storyboard_id: input.baselineId ?? null,
        p_preservation: input.preservation ?? [],
        p_storyboard_id: storyboardId,
        p_bundle_fingerprint: `bundle-${storyboardId}`,
        p_act_id: randomUUID(),
        p_new_assets: newAssets,
        p_rows: [{
          id: randomUUID(),
          sceneIndex: 0,
          title: "Scene",
          beats: [
            {
              id: randomUUID(),
              panelId: randomUUID(),
              beatIndex: 0,
              planBeatId: "plan-beat-1",
              intent: "one",
              durationSec: 5,
              imageAssetId: tile1,
            },
            {
              id: randomUUID(),
              panelId: randomUUID(),
              beatIndex: 1,
              planBeatId: "plan-beat-2",
              intent: "two",
              durationSec: 5,
              imageAssetId: tile2,
            },
          ],
        }, {
          id: randomUUID(),
          sceneIndex: 1,
          title: "Empty scene",
          beats: [],
        }],
      };
    }

    try {
      const firstInvocation = await invocation();
      const firstArgs = args(firstInvocation);
      const first = await service.rpc(
        "commit_claimed_storyboard_bundle",
        firstArgs
      ).throwOnError();
      assert.equal(first.data.storyboardId, firstArgs.p_storyboard_id);
      assert.equal(first.data.panelCount, 2);

      const { data: committedJob } = await service.from("jobs")
        .select("status, result")
        .eq("id", firstArgs.p_job_id)
        .single()
        .throwOnError();
      assert.equal(committedJob.status, "succeeded");
      assert.deepEqual(committedJob.result, first.data);
      const replay = await service.rpc(
        "commit_claimed_storyboard_bundle",
        firstArgs
      ).throwOnError();
      assert.deepEqual(replay.data, first.data);
      assert.ok(
        (
          await service.rpc("commit_claimed_storyboard_bundle", {
            ...firstArgs,
            p_bundle_fingerprint: `${firstArgs.p_bundle_fingerprint}-changed`,
          })
        ).error
      );

      const beforeStoryboards = await service.from("story_blueprints")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId);
      const beforeAssets = await service.from("assets")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId);
      const badPlan = args({
        ...(await invocation()),
        expectedSeq: selection.seq + 1,
        expectedPointer: firstArgs.p_storyboard_id,
      });
      assert.ok((await service.rpc("commit_claimed_storyboard_bundle", badPlan)).error);
      const badPointer = args({
        ...(await invocation()),
        expectedPointer: randomUUID(),
      });
      assert.ok((await service.rpc("commit_claimed_storyboard_bundle", badPointer)).error);

      const omittedEmptyScene = args({
        ...(await invocation()),
        expectedPointer: firstArgs.p_storyboard_id,
      });
      omittedEmptyScene.p_rows = omittedEmptyScene.p_rows.slice(0, 1);
      assert.ok(
        (
          await service.rpc(
            "commit_claimed_storyboard_bundle",
            omittedEmptyScene
          )
        ).error
      );

      const extraEmptyScene = args({
        ...(await invocation()),
        expectedPointer: firstArgs.p_storyboard_id,
      });
      extraEmptyScene.p_rows.push({
        id: randomUUID(),
        sceneIndex: 2,
        title: "Unexpected scene",
        beats: [],
      });
      assert.ok(
        (
          await service.rpc(
            "commit_claimed_storyboard_bundle",
            extraEmptyScene
          )
        ).error
      );

      const extraEdge = args({
        ...(await invocation()),
        expectedPointer: firstArgs.p_storyboard_id,
      });
      extraEdge.p_new_assets[0].inputs.push({
        ...extraEdge.p_new_assets[0].inputs[0],
        role: "unexpected",
      });
      assert.ok((await service.rpc("commit_claimed_storyboard_bundle", extraEdge)).error);

      const badFingerprint = args({
        ...(await invocation()),
        expectedPointer: firstArgs.p_storyboard_id,
      });
      badFingerprint.p_new_assets[0].inputsFingerprint =
        `${badFingerprint.p_new_assets[0].inputsFingerprint}-changed`;
      assert.ok(
        (
          await service.rpc(
            "commit_claimed_storyboard_bundle",
            badFingerprint
          )
        ).error
      );

      const { data: baselineScene } = await service
        .from("story_blueprint_scenes")
        .select("id")
        .eq("story_blueprint_id", firstArgs.p_storyboard_id)
        .eq("position", 0)
        .single()
        .throwOnError();
      const { data: baselineBeat } = await service
        .from("story_beats")
        .select("id")
        .eq("scene_id", baselineScene.id)
        .eq("beat_index", 0)
        .single()
        .throwOnError();
      const { data: baselinePanel } = await service
        .from("story_panels")
        .select("id, image_asset_id")
        .eq("beat_id", baselineBeat.id)
        .eq("is_selected", true)
        .single()
        .throwOnError();

      const swapped = args({
        ...(await invocation()),
        expectedPointer: firstArgs.p_storyboard_id,
      });
      const firstSwappedAssetId =
        swapped.p_rows[0].beats[0].imageAssetId;
      swapped.p_rows[0].beats[0].imageAssetId =
        swapped.p_rows[0].beats[1].imageAssetId;
      swapped.p_rows[0].beats[1].imageAssetId = firstSwappedAssetId;
      assert.ok((await service.rpc("commit_claimed_storyboard_bundle", swapped)).error);

      const omittedPreservation = args({
        ...(await invocation()),
        expectedPointer: firstArgs.p_storyboard_id,
        baselineId: firstArgs.p_storyboard_id,
      });
      omittedPreservation.p_new_assets =
        omittedPreservation.p_new_assets.slice(1);
      omittedPreservation.p_rows[0].beats[0].imageAssetId =
        baselinePanel.image_asset_id;
      assert.ok(
        (
          await service.rpc(
            "commit_claimed_storyboard_bundle",
            omittedPreservation
          )
        ).error
      );

      const baselineRace = args({
        ...(await invocation()),
        expectedPointer: firstArgs.p_storyboard_id,
        baselineId: firstArgs.p_storyboard_id,
        preservation: [{
          planBeatId: "plan-beat-1",
          sceneIndex: 0,
          beatIndex: 0,
          relationalSceneId: baselineScene.id,
          relationalBeatId: baselineBeat.id,
          panelId: baselinePanel.id,
          assetId: baselinePanel.image_asset_id,
          assetContentHash: "tile-hash-1",
        }],
      });
      baselineRace.p_new_assets = baselineRace.p_new_assets.slice(1);
      baselineRace.p_rows[0].beats[0].imageAssetId =
        baselinePanel.image_asset_id;
      await service.from("story_panels")
        .update({ is_selected: false })
        .eq("id", baselinePanel.id)
        .throwOnError();
      assert.ok((await service.rpc("commit_claimed_storyboard_bundle", baselineRace)).error);

      assert.equal(
        await releaseSessionRun({
          projectId,
          sessionId: run.agentSessionId!,
          runId: run.id,
        }),
        true
      );
      const stale = args({
        ...(await invocation()),
        expectedPointer: firstArgs.p_storyboard_id,
      });
      assert.ok((await service.rpc("commit_claimed_storyboard_bundle", stale)).error);
      const afterStoryboards = await service.from("story_blueprints")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId);
      const afterAssets = await service.from("assets")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId);
      assert.equal(afterStoryboards.count, beforeStoryboards.count);
      assert.equal(afterAssets.count, beforeAssets.count);
    } finally {
      await service.from("projects").delete().eq("id", projectId);
      await service.from("workspaces").delete().eq("id", workspaceId);
    }
  }
);
