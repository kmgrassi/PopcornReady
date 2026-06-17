import {
  createAssembleTimelineTool,
  type AssembleTimelineDeps,
} from "./assemble-timeline";
import { createBriefTool, type CreateBriefDeps } from "./create-or-load-brief";
import {
  createCritiqueTimelineTool,
  type CritiqueTimelineDeps,
} from "./critique-timeline";
import {
  createDevelopStoryBlueprintTool,
  type DevelopStoryBlueprintDeps,
} from "./develop-story-blueprint";
import { createDraftScriptTool, type DraftScriptDeps } from "./draft-script";
import { createExportVideoTool, type ExportVideoDeps } from "./export-video";
import { createGenerateAnchorTool, type GenerateAnchorDeps } from "./generate-anchor";
import { createGenerateAudioTool, type GenerateAudioDeps } from "./generate-audio";
import { createGenerateClipTool, type GenerateClipDeps } from "./generate-clip";
import {
  createGenerateKeyframeTool,
  type GenerateKeyframeDeps,
} from "./generate-keyframe";
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
  critiqueTimeline?: Partial<CritiqueTimelineDeps>;
  developStoryBlueprint?: Partial<DevelopStoryBlueprintDeps>;
  draftScript?: Partial<DraftScriptDeps>;
  exportVideo?: Partial<ExportVideoDeps>;
  generateAnchor?: Partial<GenerateAnchorDeps>;
  generateAudio?: Partial<GenerateAudioDeps>;
  generateKeyframe?: Partial<GenerateKeyframeDeps>;
  generateClip?: Partial<GenerateClipDeps>;
  generateStoryboard?: Partial<GenerateStoryboardDeps>;
  planVisualAnchors?: Partial<PlanVisualAnchorsDeps>;
  requestApproval?: Partial<RequestApprovalDeps>;
  assembleTimeline?: Partial<AssembleTimelineDeps>;
}

export function createDefaultToolRegistry(
  deps: DefaultToolRegistryDeps = {}
): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(createBriefTool(deps.createBrief));
  registry.register(createDevelopStoryBlueprintTool(deps.developStoryBlueprint));
  registry.register(createDraftScriptTool(deps.draftScript));
  registry.register(createPlanShotsTool(deps.planShots));
  registry.register(createPlanVisualAnchorsTool(deps.planVisualAnchors));
  registry.register(createGenerateAnchorTool(deps.generateAnchor));
  registry.register(createGenerateAudioTool(deps.generateAudio));
  registry.register(createGenerateStoryboardTool(deps.generateStoryboard));
  registry.register(createGenerateKeyframeTool(deps.generateKeyframe));
  registry.register(createGenerateClipTool(deps.generateClip));
  registry.register(createCritiqueTimelineTool(deps.critiqueTimeline));
  registry.register(createExportVideoTool(deps.exportVideo));
  registry.register(createRequestApprovalTool(deps.requestApproval));
  registry.register(createAssembleTimelineTool(deps.assembleTimeline));
  return registry;
}
