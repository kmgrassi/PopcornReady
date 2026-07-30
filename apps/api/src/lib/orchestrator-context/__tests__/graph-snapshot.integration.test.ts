import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { ActionId, DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";
import { createClient } from "@supabase/supabase-js";

import { loadDomainTurnProjection } from "../domain-projection";

const localUrl = process.env.SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const runLocalIntegration =
  process.env.RUN_LOCAL_DB_INTEGRATION === "1" &&
  /127\.0\.0\.1|localhost/.test(localUrl) &&
  Boolean(serviceRoleKey);
const integrationTest = runLocalIntegration ? test : test.skip;

function creatorDirectImageTask(
  projectId: string,
  actorId: string
): DomainTaskV1 {
  return {
    schemaVersion: "DomainTask.v1",
    domain: "visuals",
    taskKind: "image_create",
    objective: "Create one standalone image.",
    instruction: "Generate a minimal smoke-test image.",
    targets: [{ kind: "project", projectId }],
    requiredOutputs: [{ kind: "image", role: "primary", minimumCount: 1 }],
    allowedOutputKinds: ["image"],
    creativeConstraints: {},
    preserve: {
      assetIds: [],
      selections: [],
      fingerprints: [],
      pins: [],
    },
    candidateAffectedAssetIds: [],
    budgetUsd: 1,
    acceptanceCriteria: ["One image exists."],
    origin: {
      kind: "creator_direct",
      actorId,
      creatorMessageId: randomUUID(),
      entrypoint: "asset_studio",
      requestDigest: randomUUID(),
      idempotencyKey: randomUUID(),
      approvalGateId: randomUUID(),
    },
    responseRecipient: { kind: "creator_conversation" },
    approvalContext: {
      proposalActionId: randomUUID() as ActionId,
      approvedBudgetUsd: 1,
      approvalFingerprint: randomUUID(),
    },
  };
}

integrationTest(
  "creator-direct image context loads through the unified story spine without a provider call",
  async () => {
    const db = createClient(localUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const actorId = randomUUID();

    try {
      let response = await db.from("workspaces").insert({
        id: workspaceId,
        name: `Graph snapshot smoke ${workspaceId}`,
      });
      assert.equal(response.error, null, response.error?.message);
      response = await db.from("projects").insert({
        id: projectId,
        workspace_id: workspaceId,
        name: `Creator-direct context ${projectId}`,
        visibility: "private",
      });
      assert.equal(response.error, null, response.error?.message);

      const projection = await loadDomainTurnProjection({
        workspaceId,
        projectId,
        task: creatorDirectImageTask(projectId, actorId),
      });

      assert.equal(projection.trusted.projectId, projectId);
      assert.equal(projection.trusted.workspaceId, workspaceId);
      assert.equal(projection.trusted.taskKind, "image_create");
      assert.deepEqual(projection.graph.story.storyboards, []);
      assert.deepEqual(projection.graph.story.scenes, []);
      assert.deepEqual(projection.graph.story.beats, []);
      assert.deepEqual(projection.graph.story.panels, []);
    } finally {
      await db.from("workspaces").delete().eq("id", workspaceId);
    }
  }
);
