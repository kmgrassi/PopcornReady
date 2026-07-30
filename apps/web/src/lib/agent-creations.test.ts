import assert from "node:assert/strict";
import test from "node:test";
import {
  creationKindFor,
  creationProposalBodyFor,
} from "./agent-creations";

test("Asset Studio maps creator-facing goals to creator-direct task kinds", () => {
  assert.equal(creationKindFor("image"), "image_create");
  assert.equal(creationKindFor("video"), "video_create");
  assert.equal(creationKindFor("soundtrack"), "soundtrack_create");
});

test("Asset Studio maps image prompt-improvement choices into proposal payloads", () => {
  const base = {
    goal: "image" as const,
    prompt: "A restrained editorial product still",
    maximumUsd: 10,
  };

  assert.deepEqual(creationProposalBodyFor({ ...base, improvePrompt: true }), {
    kind: "image_create",
    prompt: base.prompt,
    maximumUsd: 10,
    referenceAssetIds: [],
    improvePrompt: true,
  });
  assert.deepEqual(creationProposalBodyFor({ ...base, improvePrompt: false }), {
    kind: "image_create",
    prompt: base.prompt,
    maximumUsd: 10,
    referenceAssetIds: [],
    improvePrompt: false,
  });
});

test("Asset Studio omits image prompt improvement for non-image proposals", () => {
  assert.deepEqual(
    creationProposalBodyFor({
      goal: "video",
      prompt: "A restrained editorial motion study",
      improvePrompt: true,
      maximumUsd: 10,
    }),
    {
      kind: "video_create",
      prompt: "A restrained editorial motion study",
      maximumUsd: 10,
      referenceAssetIds: [],
    },
  );
});
