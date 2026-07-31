import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import type {
  ActionId,
  DomainTaskV1,
  OrchestratorRunId,
} from "@popcorn/shared/domain-agent-contract";

const localUrl = process.env.SUPABASE_URL ?? "";
const runLocalIntegration =
  process.env.RUN_LOCAL_DB_INTEGRATION === "1" &&
  /127\.0\.0\.1|localhost/.test(localUrl) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
const integrationTest = runLocalIntegration ? test : test.skip;

integrationTest("a reclaimed Visuals claim cannot mint a pooled image revision", async () => {
  const service = createClient(
    localUrl,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const sourceAssetId = randomUUID();
  const rootRunId = randomUUID();
  const domainRunId = randomUUID();
  const delegationActionId = randomUUID();
  const generationActionId = randomUUID();

  try {
    let result = await service.from("workspaces").insert({
      id: workspaceId,
      name: `__pooled_claim_test__${workspaceId}`,
    });
    assert.equal(result.error, null, result.error?.message);
    result = await service.from("projects").insert({
      id: projectId,
      workspace_id: workspaceId,
      name: "Pooled claim fence test",
      visibility: "private",
    });
    assert.equal(result.error, null, result.error?.message);
    result = await service.from("assets").insert({
      id: sourceAssetId,
      workspace_id: workspaceId,
      project_id: projectId,
      kind: "image",
      media: "image",
      status: "ready",
      filename: "source.png",
      params: { schema_version: "asset_params.v1" },
      inputs: [],
      content_hash: "source-hash",
      storage_key: `${workspaceId}/${projectId}/${sourceAssetId}/source.png`,
      storage_bucket: "assets-public",
      source: { type: "generated", generatedAssetId: sourceAssetId },
    });
    assert.equal(result.error, null, result.error?.message);
    result = await service.from("orchestrator_runs").insert({
      id: rootRunId,
      project_id: projectId,
      status: "running",
      input_summary: "root",
      root_execution_profile: "creative_director",
    });
    assert.equal(result.error, null, result.error?.message);
    result = await service.from("actions").insert({
      id: delegationActionId,
      project_id: projectId,
      orchestrator_run_id: rootRunId,
      tool: "delegate_visuals",
      status: "running",
    });
    assert.equal(result.error, null, result.error?.message);

    const allocation = await service.rpc("allocate_agent_session_sequence", {
      p_project_id: projectId,
      p_domain: "visuals",
    });
    assert.equal(allocation.error, null, allocation.error?.message);
    const allocated = (allocation.data as Array<{
      session_id: string;
      allocated_sequence: number;
    }>)[0]!;
    const task: DomainTaskV1 = {
      schemaVersion: "DomainTask.v1",
      domain: "visuals",
      taskKind: "visuals_revision",
      objective: "Revise one image",
      instruction: "Produce the approved pooled alternative",
      targets: [{ kind: "asset", projectId, assetId: sourceAssetId }],
      requiredOutputs: [{ kind: "image", role: "primary", minimumCount: 1 }],
      allowedOutputKinds: ["image"],
      creativeConstraints: {},
      preserve: { assetIds: [], selections: [], fingerprints: [], pins: [] },
      candidateAffectedAssetIds: [],
      budgetUsd: 1,
      acceptanceCriteria: ["One pooled image exists"],
      origin: {
        kind: "creative_director",
        rootRunId: rootRunId as OrchestratorRunId,
        rootActionId: delegationActionId as ActionId,
        creatorMessageId: randomUUID(),
      },
      responseRecipient: { kind: "creative_director" },
    };
    result = await service.from("orchestrator_runs").insert({
      id: domainRunId,
      project_id: projectId,
      status: "running",
      input_summary: "visuals revision",
      agent_role: "visuals",
      agent_session_id: allocated.session_id,
      session_sequence: allocated.allocated_sequence,
      task_kind: "visuals_revision",
      task_params: task,
      origin_kind: "creative_director",
      parent_run_id: rootRunId,
      root_action_id: delegationActionId,
    });
    assert.equal(result.error, null, result.error?.message);
    result = await service
      .from("agent_sessions")
      .update({ active_run_id: domainRunId, claim_generation: 1 })
      .eq("id", allocated.session_id);
    assert.equal(result.error, null, result.error?.message);
    result = await service
      .from("agent_sessions")
      .update({ claim_generation: 2 })
      .eq("id", allocated.session_id);
    assert.equal(result.error, null, result.error?.message);
    result = await service.from("actions").insert({
      id: generationActionId,
      project_id: projectId,
      orchestrator_run_id: domainRunId,
      tool: "generate_keyframe",
      status: "running",
    });
    assert.equal(result.error, null, result.error?.message);

    const stale = await service.rpc("regenerate_asset_version_pooled", {
      p_workspace_id: workspaceId,
      p_old_asset_id: sourceAssetId,
      p_filename: "stale.png",
      p_storage_key: `${workspaceId}/${projectId}/${sourceAssetId}/stale.png`,
      p_storage_bucket: "assets-public",
      p_params: { schema_version: "asset_params.v1" },
      p_content_hash: "stale-hash",
      p_action_id: generationActionId,
      p_run_id: domainRunId,
      p_session_claim_generation: 1,
      p_inputs: [{
        assetId: sourceAssetId,
        relation: "input",
        role: "source",
        position: 0,
        contentHash: "source-hash",
      }],
    });
    assert.ok(stale.error);
    assert.match(stale.error!.message, /stale_session_claim/);

    const [assets, edges, action] = await Promise.all([
      service.from("assets").select("id").eq("project_id", projectId),
      service.from("asset_edges").select("id").eq("project_id", projectId),
      service.from("actions").select("status").eq("id", generationActionId).single(),
    ]);
    assert.equal(assets.error, null, assets.error?.message);
    assert.deepEqual(assets.data, [{ id: sourceAssetId }]);
    assert.equal(edges.error, null, edges.error?.message);
    assert.deepEqual(edges.data, []);
    assert.equal(action.error, null, action.error?.message);
    assert.equal(action.data.status, "running");
  } finally {
    await service.from("workspaces").delete().eq("id", workspaceId);
  }
});
