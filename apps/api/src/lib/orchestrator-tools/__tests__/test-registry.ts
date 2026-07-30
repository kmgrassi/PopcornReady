import { createAudioToolRegistry } from "../audio-registry";
import { PRODUCTION_TOOL_NAMES } from "../capability-catalog";
import { createRootToolRegistry } from "../root-registry";
import { ToolRegistry } from "../registry";
import type { ToolRegistryDeps } from "../registry-deps";
import { createVisualsToolRegistry } from "../visuals-registry";

/** Test-only aggregate for primitive contract coverage. Production has no all-tools registry. */
export function createTestToolRegistry(deps: ToolRegistryDeps = {}): ToolRegistry {
  const registry = new ToolRegistry();
  const ownedByName = new Map(
    [
      ...createRootToolRegistry(deps).list(),
      ...createVisualsToolRegistry(deps).list(),
      ...createAudioToolRegistry(deps).list(),
    ].map((tool) => [tool.name, tool] as const)
  );
  for (const name of PRODUCTION_TOOL_NAMES) {
    const tool = ownedByName.get(name);
    if (!tool) throw new Error(`Test registry is missing owner for ${name}.`);
    registry.register(tool);
  }
  return registry;
}
