import assert from "node:assert/strict";
import test from "node:test";
import {
  readScriptCreationHandoff,
  SCRIPT_CREATION_PROMPT_MAX_LENGTH,
  scriptCreationHandoffState,
} from "./scriptCreationHandoff";

test("script creation handoff trims and reconstructs the trusted Studio seed", () => {
  assert.deepEqual(
    readScriptCreationHandoff(
      scriptCreationHandoffState("  A warm thirty-second founder story  "),
    ),
    {
      startSource: "idea",
      goal: "A warm thirty-second founder story",
    },
  );
});

test("script creation handoff rejects blank, oversized, foreign, and malformed state", () => {
  const prototypeState = Object.create({ scriptCreationHandoff: {} });
  const nullPrototypeState = Object.create(null);

  for (const value of [
    null,
    [],
    {},
    prototypeState,
    nullPrototypeState,
    { scriptCreationHandoff: null },
    {
      scriptCreationHandoff: {
        schemaVersion: "scriptCreationHandoff.v2",
        prompt: "A story",
      },
    },
    {
      scriptCreationHandoff: {
        schemaVersion: "scriptCreationHandoff.v1",
        prompt: "   ",
      },
    },
    {
      scriptCreationHandoff: {
        schemaVersion: "scriptCreationHandoff.v1",
        prompt: "x".repeat(SCRIPT_CREATION_PROMPT_MAX_LENGTH + 1),
      },
    },
    {
      scriptCreationHandoff: {
        schemaVersion: "scriptCreationHandoff.v1",
        prompt: "A story",
        projectId: "foreign-authority",
      },
    },
  ]) {
    assert.equal(readScriptCreationHandoff(value), null);
  }
});
