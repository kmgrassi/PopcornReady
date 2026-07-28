import type { DefaultToolRegistryDeps } from "./default-registry";
import {
  createDelegateAudioTool,
  createDelegateDomainsTool,
  createDelegateVisualsTool,
} from "./delegate-domain";
import { createOwnedToolRegistry } from "./owned-registry";
import type { ToolRegistry } from "./registry";

/**
 * Dormant Creative Director registry boundary; not wired into production.
 * The root view of the shared flat definitions PLUS the root-only
 * delegate_visuals/delegate_audio dispatch adapters (PR 6) — the dispatch
 * tools are registered here and ONLY here, never in the flat production
 * default registry or any domain registry.
 */
export function createRootToolRegistry(
  deps: DefaultToolRegistryDeps = {}
): ToolRegistry {
  const registry = createOwnedToolRegistry("creative_director", deps);
  registry.register(createDelegateVisualsTool());
  registry.register(createDelegateAudioTool());
  registry.register(createDelegateDomainsTool());
  return registry;
}
