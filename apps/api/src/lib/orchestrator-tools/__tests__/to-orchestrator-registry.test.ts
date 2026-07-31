import assert from "node:assert/strict";
import test from "node:test";

import { createTestToolRegistry } from "./test-registry";
import { getToolCapability } from "../capability-catalog";
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
  const realRegistry = createTestToolRegistry();
  const registry = toOrchestratorRegistry(realRegistry);
  const planShots = registry.get("plan_shots");
  assert.ok(planShots, "plan_shots must be in the bridged registry");

  // The model-facing description carries preconditions, produces, and use-when
  // so it can pick the tool proactively rather than probing the pipeline.
  assert.match(planShots.description, /Plan ordered scenes and beats/);
  assert.match(planShots.description, /Preconditions:/);
  assert.match(planShots.description, /create_or_load_brief first/);
  assert.match(planShots.description, /Produces:/);
  assert.match(planShots.description, /Use this when:/);
  assert.strictEqual(planShots.inputSchema, realRegistry.get("plan_shots").inputSchema);
  assert.strictEqual(planShots.outputSchema, realRegistry.get("plan_shots").outputSchema);
});

test("bridge carries catalog metadata without changing model schemas or descriptions", () => {
  const realRegistry = createTestToolRegistry();
  const registry = toOrchestratorRegistry(realRegistry);
  for (const [name, bridged] of registry) {
    const real = realRegistry.get(name);
    const metadata = getToolCapability(name);
    assert.equal(bridged.capability, metadata.capability);
    assert.equal(bridged.ownerRole, metadata.ownerRole);
    assert.equal(bridged.label, metadata.label);
    assert.equal(bridged.displayOrder, metadata.displayOrder);
    assert.equal(bridged.costClass, metadata.costClass);
    assert.deepEqual(bridged.gate, metadata.gate);
    assert.equal(bridged.mode, real.execution);
    assert.equal(bridged.description, composeToolDescription(real.description, real.usage));
    assert.strictEqual(bridged.inputSchema, real.inputSchema);
    assert.strictEqual(bridged.outputSchema, real.outputSchema);
  }
});

test("bridged tools delegate cost estimates to the real registry", async () => {
  const registry = toOrchestratorRegistry(createTestToolRegistry());
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
  const registry = toOrchestratorRegistry(createTestToolRegistry());
  for (const definition of registry.values()) {
    assert.match(
      definition.description,
      /Use this when:/,
      `${definition.name} is missing usage guidance`
    );
  }
});
