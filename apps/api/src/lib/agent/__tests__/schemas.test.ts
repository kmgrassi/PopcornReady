import assert from "node:assert/strict";
import test from "node:test";

import { planEdit } from "../index";
import { planRevisionSchema, planSchema } from "../schemas";

test("revision plan schema requires stable scene and beat identities", () => {
  const revisionScene = planRevisionSchema.properties.scenes.items;
  const revisionBeat = revisionScene.properties.beats.items;

  assert.ok(revisionScene.required.includes("id"));
  assert.ok(revisionBeat.required.includes("id"));
  assert.equal(revisionScene.properties.id.type, "string");
  assert.equal(revisionBeat.properties.id.type, "string");
});

test("creation plan schema still permits the server to mint fresh identities", () => {
  const creationScene = planSchema.properties.scenes.items;
  const creationBeat = creationScene.properties.beats.items;

  assert.equal(creationScene.required.includes("id"), false);
  assert.equal(creationBeat.required.includes("id"), false);
});

test("planEdit selects the revision schema on the real stable-identity path", async () => {
  let observedSchema: Record<string, unknown> | null = null;
  const result = await planEdit({
    goal: "Keep the second beat and remove the first.",
    targetLengthSec: 4,
    style: "cinematic",
    aspectRatio: "16:9",
    preserveStableIds: true,
  }, {
    structured: async (request) => {
      observedSchema = request.schema;
      return {
        targetLengthSec: 4,
        style: "cinematic",
        aspectRatio: "16:9",
        scenes: [{
          id: "scene-a",
          name: "Opening",
          beats: [{
            id: "beat-b",
            name: "Second",
            intent: "Keep this beat.",
            durationSec: 4,
          }],
        }],
      };
    },
  });

  assert.equal(observedSchema, planRevisionSchema);
  assert.equal(result.scenes[0]?.id, "scene-a");
  assert.equal(result.scenes[0]?.beats[0]?.id, "beat-b");
});
