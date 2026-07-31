import type { DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";
import type { ToolRegistry } from "./registry";
import { ToolRegistry as MutableToolRegistry } from "./registry";
import { createGenerateAnchorTool } from "./generate-anchor";
import { createGenerateClipTool } from "./generate-clip";
import { createGenerateImageAssetTool } from "./generate-image-asset";
import { createGenerateKeyframeTool } from "./generate-keyframe";
import { createRegenerateImageAssetTool } from "./regenerate-image-asset";
import { createGenerateStoryboardTool } from "./generate-storyboard";
import { createGenerateVideoAssetTool } from "./generate-video-asset";
import { createEditVideoAssetTool } from "./edit-video-asset";
import { allowedVisualToolNames } from "./domain-tool-policy";
import type { ToolRegistryDeps } from "./registry-deps";

/** The eight-tool Visuals profile, optionally narrowed by trusted task kind. */
export function createVisualsToolRegistry(
  deps: ToolRegistryDeps = {},
  task?: DomainTaskV1
): ToolRegistry {
  const all = new MutableToolRegistry();
  all.register(createGenerateAnchorTool(deps.generateAnchor));
  all.register(createGenerateStoryboardTool(deps.generateStoryboard));
  all.register(createGenerateKeyframeTool(deps.generateKeyframe));
  all.register(createGenerateClipTool(deps.generateClip));
  all.register(createRegenerateImageAssetTool(deps.regenerateImageAsset));
  all.register(createEditVideoAssetTool(deps.editVideoAsset));
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
