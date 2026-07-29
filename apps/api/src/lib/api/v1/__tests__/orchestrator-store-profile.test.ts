import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCreativeDirectorHierarchyRoot,
  isCreativeDirectorHierarchyRoot,
  newAnonymousRootProfileParams,
  newRootProfileInsert,
} from "../orchestrator-store";

test("normal and anonymous new-root persistence payloads default to creative director", () => {
  assert.deepEqual(newRootProfileInsert({}), {
    root_execution_profile: "creative_director",
  });
  assert.deepEqual(newAnonymousRootProfileParams({}), {
    p_root_execution_profile: "creative_director",
  });
});

test("the hierarchy predicate fails closed for flat, null, and domain runs", () => {
  assert.equal(
    isCreativeDirectorHierarchyRoot({
      agentRole: "creative_director",
      rootExecutionProfile: "creative_director",
    }),
    true
  );
  assert.equal(isCreativeDirectorHierarchyRoot({ rootExecutionProfile: "flat" }), false);
  assert.equal(isCreativeDirectorHierarchyRoot({ rootExecutionProfile: undefined }), false);
  assert.equal(
    isCreativeDirectorHierarchyRoot({
      agentRole: "visuals",
      rootExecutionProfile: undefined,
    }),
    false
  );
  assert.throws(
    () =>
      assertCreativeDirectorHierarchyRoot(
        { id: "legacy", rootExecutionProfile: null as never },
        "resume"
      ),
    /legacy history/
  );
});

test("environment variables cannot change normal or anonymous root ownership", () => {
  const fallback = {
    POPCORN_CREATIVE_DIRECTOR_FLAT_FALLBACK: "1",
    POPCORN_CREATIVE_DIRECTOR_FLAT_FALLBACK_UNTIL: "2999-07-29T12:00:00Z",
  };
  assert.deepEqual(newRootProfileInsert(fallback), {
    root_execution_profile: "creative_director",
  });
  assert.deepEqual(newAnonymousRootProfileParams(fallback), {
    p_root_execution_profile: "creative_director",
  });
});
