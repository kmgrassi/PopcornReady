import assert from "node:assert/strict";
import test from "node:test";
import { rerunOutputAssetKinds } from "../rerun-output-asset-kind";

const projectId = "project-1";

test("story snapshot graph kind follows its stable relational target", () => {
  assert.deepEqual(rerunOutputAssetKinds({
    kind: "story_snapshot",
    target: { kind: "project", projectId },
  }), ["story_blueprint"]);
  assert.deepEqual(rerunOutputAssetKinds({
    kind: "story_snapshot",
    target: { kind: "storyboard", projectId, storyboardId: "story-1" },
  }), ["plan"]);
  assert.deepEqual(rerunOutputAssetKinds({
    kind: "story_snapshot",
    target: { kind: "scene", projectId, sceneId: "scene-1" },
  }), ["plan"]);
  assert.deepEqual(rerunOutputAssetKinds({
    kind: "story_snapshot",
    target: { kind: "beat", projectId, beatId: "beat-1" },
  }), ["beat"]);
});

test("non-story rerun outputs authorize their persisted graph kinds", () => {
  assert.deepEqual(rerunOutputAssetKinds({
    kind: "keyframe",
    target: { kind: "beat", projectId, beatId: "beat-1" },
  }), ["keyframe"]);
  assert.deepEqual(rerunOutputAssetKinds({
    kind: "clip",
    target: { kind: "beat", projectId, beatId: "beat-1" },
  }), ["clip"]);
  assert.deepEqual(rerunOutputAssetKinds({
    kind: "audio_track",
    target: { kind: "project", projectId },
  }), ["audio_track"]);
  assert.deepEqual(rerunOutputAssetKinds({
    kind: "audio_fit",
    target: { kind: "beat", projectId, beatId: "beat-1" },
  }), ["critique"]);
});
