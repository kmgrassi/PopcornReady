import { createBriefTool, type CreateBriefDeps } from "./create-or-load-brief";
import { createGenerateAnchorTool, type GenerateAnchorDeps } from "./generate-anchor";
import {
  createGenerateStoryboardTool,
  type GenerateStoryboardDeps,
} from "./generate-storyboard";
import {
  createPlanVisualAnchorsTool,
  type PlanVisualAnchorsDeps,
} from "./plan-visual-anchors";
import { createPlanShotsTool, type PlanShotsDeps } from "./plan-shots";
import { ToolRegistry } from "./registry";

export interface DefaultToolRegistryDeps {
  planShots?: Partial<PlanShotsDeps>;
  createBrief?: Partial<CreateBriefDeps>;
  generateAnchor?: Partial<GenerateAnchorDeps>;
  generateStoryboard?: Partial<GenerateStoryboardDeps>;
  planVisualAnchors?: Partial<PlanVisualAnchorsDeps>;
}

export function createDefaultToolRegistry(
  deps: DefaultToolRegistryDeps = {}
): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(createBriefTool(deps.createBrief));
  registry.register(createPlanShotsTool(deps.planShots));
  registry.register(createPlanVisualAnchorsTool(deps.planVisualAnchors));
  registry.register(createGenerateAnchorTool(deps.generateAnchor));
  registry.register(createGenerateStoryboardTool(deps.generateStoryboard));
  return registry;
}
