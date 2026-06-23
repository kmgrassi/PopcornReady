import assert from "node:assert/strict";
import test from "node:test";

import { isCharacterReferenceHarnessEnabled } from "../dev-character-reference";

test("character reference harness is opt-in outside production", () => {
  assert.equal(
    isCharacterReferenceHarnessEnabled({
      ENABLE_CHARACTER_REFERENCE_HARNESS: "1",
      NODE_ENV: "development",
    }),
    true
  );
  assert.equal(
    isCharacterReferenceHarnessEnabled({
      ENABLE_CHARACTER_REFERENCE_HARNESS: "true",
      NODE_ENV: "test",
    }),
    true
  );
});

test("character reference harness is disabled by default and in production", () => {
  assert.equal(isCharacterReferenceHarnessEnabled({ NODE_ENV: "development" }), false);
  assert.equal(
    isCharacterReferenceHarnessEnabled({
      ENABLE_CHARACTER_REFERENCE_HARNESS: "1",
      NODE_ENV: "production",
    }),
    false
  );
});
