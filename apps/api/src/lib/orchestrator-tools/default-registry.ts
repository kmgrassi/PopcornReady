import { createBriefTool, type CreateBriefDeps } from "./create-or-load-brief";
import { createExportVideoTool, type ExportVideoDeps } from "./export-video";
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
import {
  createRequestApprovalTool,
  type RequestApprovalDeps,
} from "./request-approval";
import { ToolRegistry } from "./registry";

export interface DefaultToolRegistryDeps {
  planShots?: Partial<PlanShotsDeps>;
  createBrief?: Partial<CreateBriefDeps>;
  exportVideo?: Partial<ExportVideoDeps>;
  generateAnchor?: Partial<GenerateAnchorDeps>;
  generateStoryboard?: Partial<GenerateStoryboardDeps>;
  planVisualAnchors?: Partial<PlanVisualAnchorsDeps>;
  requestApproval?: Partial<RequestApprovalDeps>;
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
  registry.register(createExportVideoTool(deps.exportVideo));
  registry.register(createRequestApprovalTool(deps.requestApproval));
  return registry;
}
