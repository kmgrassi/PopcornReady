import type { AssembleTimelineDeps } from "./assemble-timeline";
import type { CreateBriefDeps } from "./create-or-load-brief";
import type { CritiqueTimelineDeps } from "./critique-timeline";
import type { DevelopStoryBlueprintDeps } from "./develop-story-blueprint";
import type { DraftScriptDeps } from "./draft-script";
import type { EditVideoAssetDeps } from "./edit-video-asset";
import type { ExportVideoDeps } from "./export-video";
import type { FitAudioToPictureDeps } from "./fit-audio-to-picture";
import type { GenerateAnchorDeps } from "./generate-anchor";
import type { GenerateAudioDeps } from "./generate-audio";
import type { GenerateClipDeps } from "./generate-clip";
import type { GenerateImageAssetDeps } from "./generate-image-asset";
import type { GenerateKeyframeDeps } from "./generate-keyframe";
import type { RegenerateImageAssetToolDeps } from "./regenerate-image-asset";
import type { GenerateStoryboardDeps } from "./generate-storyboard";
import type { GenerateVideoAssetDeps } from "./generate-video-asset";
import type { PlanShotsDeps } from "./plan-shots";
import type { PlanVisualAnchorsDeps } from "./plan-visual-anchors";
import type { PublishToCatalogDeps } from "./publish-to-catalog";
import type { RequestApprovalDeps } from "./request-approval";

/**
 * Dependency seams shared by the role-owned registries. This is deliberately
 * not a registry factory: production must never construct an all-tools surface.
 */
export interface ToolRegistryDeps {
  planShots?: Partial<PlanShotsDeps>;
  createBrief?: Partial<CreateBriefDeps>;
  critiqueTimeline?: Partial<CritiqueTimelineDeps>;
  developStoryBlueprint?: Partial<DevelopStoryBlueprintDeps>;
  draftScript?: Partial<DraftScriptDeps>;
  exportVideo?: Partial<ExportVideoDeps>;
  fitAudioToPicture?: Partial<FitAudioToPictureDeps>;
  generateAnchor?: Partial<GenerateAnchorDeps>;
  generateAudio?: Partial<GenerateAudioDeps>;
  generateKeyframe?: Partial<GenerateKeyframeDeps>;
  generateClip?: Partial<GenerateClipDeps>;
  regenerateImageAsset?: Partial<RegenerateImageAssetToolDeps>;
  editVideoAsset?: Partial<EditVideoAssetDeps>;
  generateStoryboard?: Partial<GenerateStoryboardDeps>;
  planVisualAnchors?: Partial<PlanVisualAnchorsDeps>;
  requestApproval?: Partial<RequestApprovalDeps>;
  assembleTimeline?: Partial<AssembleTimelineDeps>;
  publishToCatalog?: Partial<PublishToCatalogDeps>;
  generateImageAsset?: Partial<GenerateImageAssetDeps>;
  generateVideoAsset?: Partial<GenerateVideoAssetDeps>;
}
