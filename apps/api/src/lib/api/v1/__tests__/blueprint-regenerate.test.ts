import assert from "node:assert/strict";
import { test } from "node:test";

import { ApiError } from "@/core/errors";
import { assertRegenerateTarget } from "../blueprint-regenerate";

test("assertRegenerateTarget accepts the project's current storyboard", () => {
  assert.doesNotThrow(() =>
    assertRegenerateTarget({
      storyboardId: "sb_current",
      storyboardStatus: "draft",
      currentStoryBlueprintId: "sb_current",
    })
  );
});

test("assertRegenerateTarget accepts a non-superseded target when no current pointer exists", () => {
  assert.doesNotThrow(() =>
    assertRegenerateTarget({
      storyboardId: "sb_only",
      storyboardStatus: "approved",
      currentStoryBlueprintId: null,
    })
  );
});

test("assertRegenerateTarget rejects a non-current storyboard and names the current one", () => {
  assert.throws(
    () =>
      assertRegenerateTarget({
        storyboardId: "sb_old",
        storyboardStatus: "draft",
        currentStoryBlueprintId: "sb_current",
      }),
    (err) =>
      err instanceof ApiError &&
      err.code === "validation_failed" &&
      err.details?.currentStoryBlueprintId === "sb_current"
  );
});

test("assertRegenerateTarget rejects an already-superseded storyboard", () => {
  assert.throws(
    () =>
      assertRegenerateTarget({
        storyboardId: "sb_old",
        storyboardStatus: "superseded",
        currentStoryBlueprintId: "sb_current",
      }),
    (err) => err instanceof ApiError && err.code === "validation_failed"
  );
});
