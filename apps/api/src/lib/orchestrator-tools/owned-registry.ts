import type { AgentRole } from "@popcorn/shared/domain-agent-contract";
import {
  createDefaultToolRegistry,
  type DefaultToolRegistryDeps,
} from "./default-registry";
import { ToolRegistry } from "./registry";

/** Builds a dormant role view from the same definitions as the flat registry. */
export function createOwnedToolRegistry(
  ownerRole: AgentRole,
  deps: DefaultToolRegistryDeps = {}
): ToolRegistry {
  const flatRegistry = createDefaultToolRegistry(deps);
  const ownedRegistry = new ToolRegistry();
  for (const definition of flatRegistry.list()) {
    if (definition.ownerRole === ownerRole) {
      ownedRegistry.register(definition);
    }
  }
  return ownedRegistry;
}
