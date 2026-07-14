import type { DefaultToolRegistryDeps } from "./default-registry";
import { createOwnedToolRegistry } from "./owned-registry";
import type { ToolRegistry } from "./registry";

/** Dormant Audio registry boundary; not wired into production. */
export function createAudioToolRegistry(
  deps: DefaultToolRegistryDeps = {}
): ToolRegistry {
  return createOwnedToolRegistry("audio", deps);
}
