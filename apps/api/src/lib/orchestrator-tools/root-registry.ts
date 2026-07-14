import type { DefaultToolRegistryDeps } from "./default-registry";
import { createOwnedToolRegistry } from "./owned-registry";
import type { ToolRegistry } from "./registry";

/** Dormant Creative Director registry boundary; not wired into production. */
export function createRootToolRegistry(
  deps: DefaultToolRegistryDeps = {}
): ToolRegistry {
  return createOwnedToolRegistry("creative_director", deps);
}
