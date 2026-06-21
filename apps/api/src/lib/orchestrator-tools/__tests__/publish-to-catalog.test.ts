import assert from "node:assert/strict";
import test from "node:test";

import type { AuthContext } from "@/lib/api/v1/auth";
import { SYSTEM_PUBLISHER_WORKSPACE_ID } from "@/lib/api/v1/system-identity";
import {
  createPublishToCatalogTool,
  parsePublishToCatalogInput,
} from "../publish-to-catalog";
import { ToolInputError, type ToolCallResult } from "../types";

const auth: AuthContext = {
  mode: "local",
  actor: { id: "local_dev", type: "local" },
  workspaceId: "ws_user",
  isLocal: true,
};

function fakeDeps(capture: { publishArgs?: unknown } = {}) {
  return {
    createAction: async () => ({ id: "action_1" }) as never,
    updateAction: async () => undefined as never,
    publishCatalogEntry: (async (input: unknown) => {
      capture.publishArgs = input;
      return { id: "catalog_entry_1" } as never;
    }) as never,
  };
}

test("publish_to_catalog attributes the entry to the system publisher, reads the asset from the run workspace", async () => {
  const capture: { publishArgs?: unknown } = {};
  const tool = createPublishToCatalogTool(fakeDeps(capture));
  const result = (await tool.execute(
    { kind: "image", title: "Neo-noir city", sourceAssetId: "asset_9", tags: ["noir"] },
    { auth, projectId: "proj_1", orchestratorRunId: "run_1" }
  )) as ToolCallResult;

  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded") {
    assert.deepEqual(result.resourceIds, ["catalog_entry_1"]);
  }
  const args = capture.publishArgs as {
    authWorkspaceId: string;
    publisherWorkspaceId: string;
    body: { kind: string; sourceAssetId: string; status: string };
  };
  // attribution -> system publisher; source read -> the run's workspace.
  assert.equal(args.publisherWorkspaceId, SYSTEM_PUBLISHER_WORKSPACE_ID);
  assert.equal(args.authWorkspaceId, "ws_user");
  assert.equal(args.body.kind, "image");
  assert.equal(args.body.sourceAssetId, "asset_9");
  assert.equal(args.body.status, "published");
});

test("publish_to_catalog fails without a projectId", async () => {
  const tool = createPublishToCatalogTool(fakeDeps());
  const result = (await tool.execute(
    { kind: "image", title: "x", sourceAssetId: "a" },
    { auth }
  )) as ToolCallResult;
  assert.equal(result.status, "failed");
});

test("parse: image/character require sourceAssetId, story requires sourceStoryBlueprintId", () => {
  assert.throws(() => parsePublishToCatalogInput({ kind: "image", title: "x" }), ToolInputError);
  assert.throws(() => parsePublishToCatalogInput({ kind: "story", title: "x" }), ToolInputError);
  assert.throws(() => parsePublishToCatalogInput({ kind: "bogus", title: "x" }), ToolInputError);
  assert.throws(() => parsePublishToCatalogInput({ kind: "image", sourceAssetId: "a" }), ToolInputError);

  const ok = parsePublishToCatalogInput({ kind: "story", title: "Tale", sourceStoryBlueprintId: "sb_1" });
  assert.equal(ok.kind, "story");
  assert.equal(ok.sourceStoryBlueprintId, "sb_1");
});
