import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultToolRegistry } from "../default-registry";
import {
  composeToolDescription,
  toOrchestratorRegistry,
} from "../to-orchestrator-registry";

test("composeToolDescription returns the base description unchanged without usage", () => {
  assert.equal(composeToolDescription("Just the basics."), "Just the basics.");
});

test("composeToolDescription appends only the usage sections that are present", () => {
  const composed = composeToolDescription("Base.", {
    preconditions: ["A exists."],
    useWhen: ["You need B.", "C was rejected."],
  });

  assert.equal(
    composed,
    [
      "Base.",
      "Preconditions:\n- A exists.",
      "Use this when:\n- You need B.\n- C was rejected.",
    ].join("\n\n")
  );
  // 'Produces' was omitted, so it must not appear.
  assert.doesNotMatch(composed, /Produces:/);
});

test("bridged tools expose composed usage guidance to the model", () => {
  const registry = toOrchestratorRegistry(createDefaultToolRegistry());
  const planShots = registry.get("plan_shots");
  assert.ok(planShots, "plan_shots must be in the bridged registry");

  // The model-facing description carries preconditions, produces, and use-when
  // so it can pick the tool proactively rather than probing the pipeline.
  assert.match(planShots.description, /Plan ordered scenes and beats/);
  assert.match(planShots.description, /Preconditions:/);
  assert.match(planShots.description, /create_or_load_brief first/);
  assert.match(planShots.description, /Produces:/);
  assert.match(planShots.description, /Use this when:/);
});

test("bridged tools delegate cost estimates to the real registry", async () => {
  const registry = toOrchestratorRegistry(createDefaultToolRegistry());
  const generateClip = registry.get("generate_clip");
  assert.ok(generateClip, "generate_clip must be in the bridged registry");

  const estimate = await generateClip.estimateCostUsd(
    { provider: "openai", durationSec: 8 },
    {
      workspaceId: "ws_1",
      projectId: "proj_1",
      orchestratorRunId: "run_1",
      toolCallId: "tool_call_1",
    }
  );

  assert.equal(estimate, 4);
});

test("every wired tool ships model-facing usage guidance", () => {
  const registry = toOrchestratorRegistry(createDefaultToolRegistry());
  for (const definition of registry.values()) {
    assert.match(
      definition.description,
      /Use this when:/,
      `${definition.name} is missing usage guidance`
    );
  }
});
