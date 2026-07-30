import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCreativeDirectorHierarchyRoot,
  isCreativeDirectorHierarchyRoot,
} from "../orchestrator-store";

test("the hierarchy predicate is role-owned after profile retirement", () => {
  assert.equal(
    isCreativeDirectorHierarchyRoot({
      agentRole: "creative_director",
    }),
    true
  );
  assert.equal(isCreativeDirectorHierarchyRoot({}), true);
  assert.equal(
    isCreativeDirectorHierarchyRoot({
      agentRole: "visuals",
    }),
    false
  );
  assert.throws(
    () =>
      assertCreativeDirectorHierarchyRoot(
        { id: "domain", agentRole: "audio" },
        "resume"
      ),
    /not a Creative Director root/
  );
});
