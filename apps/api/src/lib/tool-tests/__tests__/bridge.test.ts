import assert from "node:assert/strict";
import test from "node:test";

import type { ToolExecutionContext as DriverContext } from "@/lib/orchestrator";
import { PRODUCTION_TOOL_NAMES } from "@/lib/orchestrator";
import { ToolRegistry } from "@/lib/orchestrator-tools/registry";
import { toolDefinitionMetadata } from "@/lib/orchestrator-tools/capability-catalog";
import type {
  ToolDefinition,
  ToolExecutionContext as RealContext,
} from "@/lib/orchestrator-tools/types";
import { toOrchestratorRegistry } from "../bridge";

function fakeTool(
  capture?: (input: unknown, context: RealContext) => void
): ToolDefinition<{ goal: string }, { echoed: string }> {
  return {
    ...toolDefinitionMetadata("plan_shots"),
    description: "fake plan_shots",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    parseInput: (input) => input as { goal: string },
    execute: (input, context) => {
      capture?.(input, context);
      return {
        status: "succeeded",
        resourceIds: [],
        output: { echoed: (input as { goal: string }).goal },
      };
    },
  };
}

const driverContext: DriverContext = {
  workspaceId: "ws_test",
  projectId: "proj_test",
  orchestratorRunId: "orch_test",
  toolCallId: "tool_call_test",
  actorId: "actor_test",
  agentId: "agent_test",
  messageId: "msg_test",
  requestId: "req_test",
  sessionClaimGeneration: 7,
  metadata: { harness: true },
};

test("only-mode bridges a single tool and maps catalog execution to mode", () => {
  const real = new ToolRegistry();
  real.register(fakeTool());
  const registry = toOrchestratorRegistry(real, { only: "plan_shots" });

  assert.equal(registry.size, 1);
  const def = registry.get("plan_shots");
  assert.ok(def);
  assert.equal(def?.name, "plan_shots");
  assert.equal(def?.mode, "sync"); // catalog execution → mode
  assert.equal(def?.ownerRole, "creative_director");
  assert.equal(def?.capability, "shot_planning");
  assert.equal(def?.label, "Shot Plan");
});

test("bridged prepare parses once and execute reuses the canonical value", async () => {
  let seen: RealContext | undefined;
  let parses = 0;
  const real = new ToolRegistry();
  const tool = fakeTool((_input, context) => (seen = context));
  tool.parseInput = (input) => {
    parses += 1;
    return { goal: String((input as { goal: string }).goal).toUpperCase() };
  };
  real.register(tool);
  const registry = toOrchestratorRegistry(real, { only: "plan_shots" });

  const definition = registry.get("plan_shots")!;
  const prepared = await definition.prepareInput!({ goal: "hi" }, driverContext);
  const result = await definition.execute(prepared, driverContext);

  assert.equal(parses, 1);
  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded") {
    assert.deepEqual(result.output, { echoed: "HI" });
  }
  // driver context is mapped into a local AuthContext for the real tool
  assert.equal(seen?.auth.workspaceId, "ws_test");
  assert.equal(seen?.auth.actor.id, "actor_test");
  assert.equal(seen?.projectId, "proj_test");
  assert.equal(seen?.toolCallId, "tool_call_test");
  assert.equal(seen?.agentId, "agent_test");
  assert.equal(seen?.messageId, "msg_test");
  assert.equal(seen?.requestId, "req_test");
  assert.equal(seen?.sessionClaimGeneration, 7);
  assert.deepEqual(seen?.metadata, { harness: true });
});

test("default mode exposes only the wired tools (no stubs)", () => {
  const real = new ToolRegistry();
  real.register(fakeTool());
  const registry = toOrchestratorRegistry(real);

  assert.equal(registry.size, 1);
  assert.ok(registry.has("plan_shots"));
  assert.equal(registry.has("export_video"), false);
});

test("includeStubs exposes the full production vocabulary with stubs for unimplemented tools", async () => {
  const real = new ToolRegistry();
  real.register(fakeTool());
  const registry = toOrchestratorRegistry(real, { includeStubs: true });

  // Stubs cover the flat production vocabulary only — root-only dispatch
  // tools (delegate_*) never join the harness surface.
  assert.equal(registry.size, PRODUCTION_TOOL_NAMES.length);

  // implemented tool is the real (bridged) one
  const planShots = await registry.get("plan_shots")!.execute({ goal: "x" }, driverContext);
  assert.equal(planShots.status, "succeeded");

  // an unimplemented tool falls back to the driver stub
  const exportVideo = await registry.get("export_video")!.execute({}, driverContext);
  assert.equal(exportVideo.status, "failed");
  if (exportVideo.status === "failed") {
    assert.equal(exportVideo.error.kind, "precondition_unmet");
  }
});
