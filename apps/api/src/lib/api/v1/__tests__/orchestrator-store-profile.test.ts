import assert from "node:assert/strict";
import test from "node:test";

import {
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

test("normal and anonymous new-root persistence payloads honor an active flat fallback", () => {
  const fallback = {
    POPCORN_CREATIVE_DIRECTOR_FLAT_FALLBACK: "1",
    POPCORN_CREATIVE_DIRECTOR_FLAT_FALLBACK_UNTIL: "2999-07-29T12:00:00Z",
  };
  assert.deepEqual(newRootProfileInsert(fallback), {
    root_execution_profile: "flat",
  });
  assert.deepEqual(newAnonymousRootProfileParams(fallback), {
    p_root_execution_profile: "flat",
  });
});
