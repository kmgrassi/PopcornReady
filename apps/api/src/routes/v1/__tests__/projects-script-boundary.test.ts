import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "@/core/errors";
import {
  assertApprovedScriptForProjectMedia,
  requireApprovedScriptForProjectMedia,
} from "@/lib/api/v1/project-media-boundary";

test("project media generation requires an approved active script", () => {
  assert.throws(
    () => assertApprovedScriptForProjectMedia(null),
    (error: unknown) => error instanceof ApiError && error.code === "validation_failed",
  );
  assert.throws(
    () => assertApprovedScriptForProjectMedia({
      scriptDraftId: "script-1",
      assetId: "asset-1",
      contentHash: "hash",
      scriptDraft: { status: "draft" },
    } as never),
    (error: unknown) => error instanceof ApiError && error.code === "validation_failed",
  );
  assert.doesNotThrow(() => assertApprovedScriptForProjectMedia({
    scriptDraftId: "script-1",
    assetId: "asset-1",
    contentHash: "hash",
    scriptDraft: { status: "approved" },
  } as never));
});

test("project media authorization runs before script-status lookup", async () => {
  let scriptReads = 0;
  await assert.rejects(
    requireApprovedScriptForProjectMedia("workspace-1", "foreign-project", {
      getProject: async () => {
        throw new ApiError("not_found", "Project not found.");
      },
      getActiveProjectScriptDraft: async () => {
        scriptReads += 1;
        return null;
      },
    }),
    (error: unknown) => error instanceof ApiError && error.code === "not_found",
  );
  assert.equal(scriptReads, 0);
});
