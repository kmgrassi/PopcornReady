import assert from "node:assert/strict";
import test from "node:test";

import { TOOL_NAMES } from "@/lib/orchestrator-tools/capability-catalog";
import { toolLabel, toolOrder } from "../orchestrator-run-projections";

test("catalog-backed run labels and ordering preserve legacy projection behavior", () => {
  const expected = {
    create_or_load_brief: ["Concept", 0],
    develop_story_blueprint: ["Story Structure", 1],
    draft_script: ["Script", 2],
    plan_shots: ["Shot Plan", 3],
    plan_visual_anchors: ["Continuity Plan", 4],
    generate_anchor: ["Anchor Images", 5],
    generate_storyboard: ["Storyboard", 6],
    generate_keyframe: ["Keyframes", 7],
    generate_clip: ["Clips", 8],
    regenerate_image_asset: ["Plan", 101],
    edit_video_asset: ["Video Edits", 9],
    generate_image_asset: ["Plan", 101],
    generate_video_asset: ["Plan", 101],
    generate_audio: ["Audio", 10],
    fit_audio_to_picture: ["Audio Sync", 11],
    assemble_timeline: ["Timeline", 12],
    critique_timeline: ["Quality Review", 13],
    request_approval: ["Approval", 14],
    export_video: ["Final Render", 15],
    publish_to_catalog: ["Publish", 16],
    // Dispatch tools (PR 6) use the same neutral stage-label/order fallback
    // as regenerate_image_asset; they never render a dedicated stage.
    delegate_visuals: ["Plan", 101],
    delegate_audio: ["Plan", 101],
  } as const;

  assert.deepEqual(
    Object.fromEntries(TOOL_NAMES.map((name) => [name, [toolLabel(name), toolOrder(name)]])),
    expected
  );
});
