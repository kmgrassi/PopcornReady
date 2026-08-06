import assert from "node:assert/strict";
import test from "node:test";
import { projectDisplayName } from "../naming";

test("projectDisplayName uses request naming context with the AI naming pipeline", async () => {
  let received: { kind: string; prompt: string; context?: string } | undefined;
  const name = await projectDisplayName(
    {
      namingPrompt: "Quiet amber-lit popcorn falling into a bowl",
      namingContext: "image",
    },
    async (input) => {
      received = input;
      return "Amber Popcorn Study";
    },
  );

  assert.equal(name, "Amber Popcorn Study");
  assert.deepEqual(received, {
    kind: "project",
    prompt: "Quiet amber-lit popcorn falling into a bowl",
    context: "asset type image",
  });
});

test("projectDisplayName falls back deterministically when AI naming fails", async () => {
  const name = await projectDisplayName(
    { namingPrompt: "quiet amber-lit popcorn falling into a bowl" },
    async () => null,
  );

  assert.equal(name, "Quiet Amber-lit Popcorn Falling Into a Bowl");
});

test("projectDisplayName skips AI naming for blank input", async () => {
  let called = false;
  const name = await projectDisplayName({ namingPrompt: "   " }, async () => {
    called = true;
    return "Unexpected";
  });

  assert.equal(name, "Untitled Project");
  assert.equal(called, false);
});
