import { createAssembleTimelineTool } from "./assemble-timeline";
import { createBriefTool } from "./create-or-load-brief";
import { createCritiqueTimelineTool } from "./critique-timeline";
import { createDevelopStoryBlueprintTool } from "./develop-story-blueprint";
import {
  createDelegateAudioTool,
  createDelegateDomainsTool,
  createDelegateVisualsTool,
} from "./delegate-domain";
import { createDraftScriptTool } from "./draft-script";
import { createExportVideoTool } from "./export-video";
import { createPlanShotsTool } from "./plan-shots";
import { createPlanVisualAnchorsTool } from "./plan-visual-anchors";
import { createPublishToCatalogTool } from "./publish-to-catalog";
import { createRequestApprovalTool } from "./request-approval";
import { ToolRegistry } from "./registry";
import type { ToolRegistryDeps } from "./registry-deps";

/**
 * Creative Director registry boundary. Root-owned planning/reconciliation and
 * delegate_* dispatch tools are registered here and ONLY here, never in a
 * domain registry.
 */
export function createRootToolRegistry(
  deps: ToolRegistryDeps = {}
): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(createBriefTool(deps.createBrief));
  registry.register(createDevelopStoryBlueprintTool(deps.developStoryBlueprint));
  registry.register(createDraftScriptTool(deps.draftScript));
  registry.register(createPlanShotsTool(deps.planShots));
  registry.register(createPlanVisualAnchorsTool(deps.planVisualAnchors));
  registry.register(createCritiqueTimelineTool(deps.critiqueTimeline));
  registry.register(createExportVideoTool(deps.exportVideo));
  registry.register(createRequestApprovalTool(deps.requestApproval));
  registry.register(createAssembleTimelineTool(deps.assembleTimeline));
  registry.register(createPublishToCatalogTool(deps.publishToCatalog));
  registry.register(createDelegateVisualsTool());
  registry.register(createDelegateAudioTool());
  registry.register(createDelegateDomainsTool());
  return registry;
}
