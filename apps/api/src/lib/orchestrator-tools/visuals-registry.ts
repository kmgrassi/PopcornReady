import type { DefaultToolRegistryDeps } from "./default-registry";
import type { DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";
import { createOwnedToolRegistry } from "./owned-registry";
import type { ToolRegistry } from "./registry";
import { ToolRegistry as MutableToolRegistry } from "./registry";
import { createGenerateImageAssetTool } from "./generate-image-asset";
import { createGenerateVideoAssetTool } from "./generate-video-asset";
import { allowedVisualToolNames } from "./domain-tool-policy";

/** The eight-tool Visuals profile, optionally narrowed by trusted task kind. */
export function createVisualsToolRegistry(
  deps: DefaultToolRegistryDeps = {},
  task?: DomainTaskV1
): ToolRegistry {
  const all = createOwnedToolRegistry("visuals", deps);
  all.register(createGenerateImageAssetTool(deps.generateImageAsset));
  all.register(createGenerateVideoAssetTool(deps.generateVideoAsset));
  if (!task) return all;

  const allowed = new Set(allowedVisualToolNames(task));
  const narrowed = new MutableToolRegistry();
  for (const definition of all.list()) {
    if (allowed.has(definition.name)) narrowed.register(definition);
  }
  return narrowed;
}
