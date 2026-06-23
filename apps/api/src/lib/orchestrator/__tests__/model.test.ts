import assert from "node:assert/strict";
import test from "node:test";

import { buildRoutingContext } from "../model";

test("routing context distinguishes missing clip keyframes from missing storyboard tiles", () => {
  const context = buildRoutingContext([
    { tool: "plan_shots", status: "applied", outputAssetIds: ["plan_1"] },
    { tool: "generate_storyboard", status: "applied", outputAssetIds: ["tile_1"] },
    {
      tool: "generate_clip",
      status: "failed",
      outputAssetIds: [],
      error: {
        kind: "precondition_unmet",
        message: "generate_clip needs active beat_keyframe assets before it can generate clips.",
        recoverable: true,
        unmetRequirements: [
          {
            requirement: "beat_keyframe",
            because: "The clip is seeded from the beat's first-frame keyframe.",
            satisfyWith: { tool: "generate_keyframe", inputHint: {} },
          },
        ],
        suggestedNextTools: [{ tool: "generate_keyframe", inputHint: {} }],
      },
    },
  ]);

  assert.equal(context.latestFailure?.tool, "generate_clip");
  assert.deepEqual(context.latestFailure?.unmetRequirements, ["beat_keyframe"]);
  assert.deepEqual(context.latestFailure?.requiredRecoveryTools, ["generate_keyframe"]);
  assert.equal(context.nextToolHint?.tool, "generate_keyframe");
  assert.match(context.nextToolHint?.reason ?? "", /generate_storyboard only creates sketch/);
});

test("routing context routes missing storyboard tiles back to generate_storyboard", () => {
  const context = buildRoutingContext([
    { tool: "plan_shots", status: "applied", outputAssetIds: ["plan_1"] },
    {
      tool: "generate_keyframe",
      status: "failed",
      outputAssetIds: [],
      error: {
        kind: "precondition_unmet",
        message: "generate_keyframe needs storyboard tiles before photoreal keyframes.",
        recoverable: true,
        unmetRequirements: [
          {
            requirement: "beat_storyboard",
            because: "Keyframes use selected storyboard tiles as structural composition references.",
            satisfyWith: { tool: "generate_storyboard", inputHint: {} },
          },
        ],
        suggestedNextTools: [{ tool: "generate_storyboard", inputHint: {} }],
      },
    },
  ]);

  assert.equal(context.latestFailure?.tool, "generate_keyframe");
  assert.deepEqual(context.latestFailure?.unmetRequirements, ["beat_storyboard"]);
  assert.deepEqual(context.latestFailure?.requiredRecoveryTools, ["generate_storyboard"]);
  assert.equal(context.nextToolHint?.tool, "generate_storyboard");
});

test("routing context clears recovery hints after a later action resolves the failure", () => {
  const context = buildRoutingContext([
    { tool: "plan_shots", status: "applied", outputAssetIds: ["plan_1"] },
    { tool: "generate_storyboard", status: "applied", outputAssetIds: ["tile_1"] },
    {
      tool: "generate_clip",
      status: "failed",
      outputAssetIds: [],
      error: {
        kind: "precondition_unmet",
        message: "generate_clip needs active beat_keyframe assets before it can generate clips.",
        recoverable: true,
        unmetRequirements: [
          {
            requirement: "beat_keyframe",
            because: "The clip is seeded from the beat's first-frame keyframe.",
            satisfyWith: { tool: "generate_keyframe", inputHint: {} },
          },
        ],
        suggestedNextTools: [{ tool: "generate_keyframe", inputHint: {} }],
      },
    },
    { tool: "generate_keyframe", status: "applied", outputAssetIds: ["keyframe_1"] },
  ]);

  assert.equal(context.latestFailure, undefined);
  assert.equal(context.nextToolHint, undefined);
  assert.ok(context.completedTools.includes("generate_keyframe"));
});
