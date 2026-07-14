import type { DefaultToolRegistryDeps } from "./default-registry";
import { createOwnedToolRegistry } from "./owned-registry";
import type { ToolRegistry } from "./registry";

/** Dormant Visuals registry boundary; not wired into production. */
export function createVisualsToolRegistry(
  deps: DefaultToolRegistryDeps = {}
): ToolRegistry {
  return createOwnedToolRegistry("visuals", deps);
}
