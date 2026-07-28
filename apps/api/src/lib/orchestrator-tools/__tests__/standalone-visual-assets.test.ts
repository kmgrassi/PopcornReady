import assert from "node:assert/strict";
import test from "node:test";

import type { AuthContext } from "@/lib/api/v1/auth";
import type { V1Asset } from "@/lib/api/v1/store";
import { createGenerateImageAssetTool } from "../generate-image-asset";
import { createGenerateVideoAssetTool } from "../generate-video-asset";
import { resolveGeneratedAssetClaimGeneration } from "@/lib/api/v1/generated-assets";

const auth: AuthContext = {
  mode: "local",
  actor: { id: "orchestrator", type: "local" },
  workspaceId: "workspace-1",
  isLocal: true,
};

const reference = {
  id: "asset-reference",
  contentHash: "sha256-reference",
} as V1Asset;

test("standalone image uses the canonical job service, generic role, and minor-safe policy", async () => {
  let body: Record<string, unknown> | undefined;
  let actionId: string | undefined;
  let claimGeneration: number | undefined;
  const tool = createGenerateImageAssetTool({
    getAsset: async () => reference,
    startGeneratedAssetJob: async (input) => {
      body = input.body as Record<string, unknown>;
      actionId = input.actionId;
      claimGeneration = input.sessionClaimGeneration;
      return { status: 202, body: { job: { id: "job-image" } } };
    },
  });
  const parsed = tool.parseInput({
    prompt: "A cinematic portrait of a teenage girl at a bus stop.",
    referenceAssetIds: ["asset-reference"],
  });
  const result = await tool.execute(parsed, {
    auth,
    projectId: "project-1",
    orchestratorRunId: "run-1",
    actionId: "action-image",
    sessionClaimGeneration: 9,
  });

  assert.deepEqual(result, {
    status: "accepted",
    jobId: "job-image",
    resumesWhen: "job_terminal",
  });
  assert.equal(body?.kind, "image");
  assert.equal(body?.assetRole, "standalone_image");
  assert.equal(body?.provider, "gemini");
  assert.equal(body?.runId, "run-1");
  assert.equal(actionId, "action-image");
  assert.equal(claimGeneration, 9);
  assert.deepEqual(body?.graphInputs, [{
    assetId: "asset-reference",
    relation: "input",
    role: "reference",
    position: 0,
    contentHash: "sha256-reference",
  }]);
});

test("standalone video has no beat prerequisite and keeps provider settings server-owned", async () => {
  let body: Record<string, unknown> | undefined;
  let actionId: string | undefined;
  const tool = createGenerateVideoAssetTool({
    getAsset: async () => reference,
    startGeneratedAssetJob: async (input) => {
      body = input.body as Record<string, unknown>;
      actionId = input.actionId;
      return { status: 202, body: { job: { id: "job-video" } } };
    },
  });
  const parsed = tool.parseInput({ prompt: "Slow dolly through a foggy arcade.", durationSec: 6 });
  const result = await tool.execute(parsed, {
    auth,
    projectId: "project-1",
    orchestratorRunId: "run-2",
    actionId: "action-video",
  });

  assert.equal(result.status, "accepted");
  assert.equal(body?.kind, "video");
  assert.equal(body?.assetRole, "standalone_video");
  assert.equal(body?.durationSec, 6);
  assert.equal(body?.runId, "run-2");
  assert.equal(actionId, "action-video");
  assert.equal("provider" in (body ?? {}), false);
  assert.equal("model" in (body ?? {}), false);
  assert.equal("beatId" in (body ?? {}), false);
});

test("standalone schemas reject model-supplied provider and unbounded duration", () => {
  const image = createGenerateImageAssetTool();
  const video = createGenerateVideoAssetTool();
  assert.throws(
    () => image.parseInput({ prompt: "A still", provider: "openai" }),
    /unsupported fields/
  );
  assert.throws(
    () => video.parseInput({ prompt: "A clip", durationSec: 60 }),
    /between 1 and 30/
  );
});

test("generated assets reject a stale supplied session claim", () => {
  assert.equal(resolveGeneratedAssetClaimGeneration(4, 4), 4);
  assert.throws(
    () => resolveGeneratedAssetClaimGeneration(4, undefined),
    /requires its exact session claim/
  );
  assert.throws(
    () => resolveGeneratedAssetClaimGeneration(5, 4),
    /session claim changed/
  );
});
