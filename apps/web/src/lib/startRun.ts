// Create-project + start-generation-run flow, lifted out of the retired
// NewProjectPage so the Studio wizard (and later step PRs) share one working
// implementation. This is the only place that turns a BriefDraft into a live
// generation run; useStudioFlow.startGeneration() calls it.

import type {
  AssetKind,
  GateableGenerationStageType,
  VideoBriefInput,
} from "@popcorn/shared/v1/types";
import type { CompositionMode } from "@popcorn/shared/v1/types";
import { v1Api } from "./api-client";
import { assertGuestRunAllowed, recordGuestRunStarted } from "./guestRunLimit";
import type { BriefDraft } from "../components/studio/useStudioFlow";

export interface StartRunResult {
  projectId: string;
  runId: string;
}

export interface CreateAndStartRunOptions {
  enforceGuestRunLimit?: boolean;
}

export const LONG_VIDEO_PLANNING_REVIEW_THRESHOLD_SEC = 30;
const LONG_VIDEO_POST_PLAN_REVIEW_GATE: GateableGenerationStageType = "storyboard";

/** Build the V1 brief payload the create/run endpoints expect from a draft. */
function briefInputFromDraft(draft: BriefDraft): VideoBriefInput {
  const requiredBeats = [draft.hook, draft.bigIdea]
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    goal: draft.goal.trim(),
    targetLengthSec: draft.targetLengthSec,
    aspectRatio: draft.aspectRatio,
    platform: draft.platform,
    format: draft.format,
    style: draft.style,
    audience: draft.audience.trim() || undefined,
    hookQuestion: draft.hook.trim() || undefined,
    strongestVisual: draft.bestVisual.trim() || undefined,
    oneBigIdea: draft.bigIdea.trim() || undefined,
    caveat: draft.accuracyNote.trim() || undefined,
    payoff: draft.payoff.trim() || undefined,
    constraints:
      requiredBeats.length > 0 || draft.payoff.trim() || draft.callToAction.trim()
        ? {
            requiredBeats: requiredBeats.length > 0 ? requiredBeats : undefined,
            callToAction: draft.callToAction.trim() || undefined,
          }
        : undefined,
  };
}

/** Prompt-only vs. footage-backed runs map onto composition modes. */
function compositionModeFromDraft(draft: BriefDraft): CompositionMode {
  if (draft.footageChoice === "upload") {
    return "hybrid";
  }
  return "prompt_only";
}

function assetKindForFile(file: File): AssetKind | null {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("audio/")) return "audio";

  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  if (["mp4", "mov", "m4v", "webm"].includes(ext)) return "video";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";
  if (["mp3", "wav", "m4a", "aac", "ogg"].includes(ext)) return "audio";
  return null;
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

async function registerSelectedFootage(
  projectId: string,
  draft: BriefDraft,
): Promise<string[]> {
  if (draft.footageChoice !== "upload") return [];
  if (draft.selectedFootage.length === 0) {
    throw new Error("Select at least one video or image before generating with footage.");
  }

  const uploads = await Promise.all(
    draft.selectedFootage.map(async (selected) => {
      const kind = assetKindForFile(selected.file);
      if (!kind) {
        throw new Error(`Could not determine asset kind for ${selected.name}.`);
      }
      const dataBase64 = await fileToBase64(selected.file);
      const { asset } = await v1Api.registerProjectUpload(projectId, {
        source: {
          type: "multipart_upload",
          dataBase64,
          mimeType: selected.file.type || undefined,
        },
        kind,
        filename: selected.name,
        durationSec: selected.durationSec,
        userContext: {
          description: `Selected in Studio Source Footage: ${selected.name}`,
          intendedUse:
            kind === "audio" ? ["music", "voiceover", "dialogue"] : ["primary_footage"],
        },
      });
      return asset;
    }),
  );

  const visualAssetIds = uploads
    .filter((asset) => asset.kind === "video" || asset.kind === "image")
    .map((asset) => asset.id);

  if (visualAssetIds.length === 0) {
    throw new Error("Select at least one video or image before generating with footage.");
  }

  return visualAssetIds;
}

function assertUploadDraftHasVisualFootage(draft: BriefDraft): void {
  if (draft.footageChoice !== "upload") return;
  const hasVisualFootage = draft.selectedFootage.some((selected) => {
    const kind = assetKindForFile(selected.file);
    return kind === "video" || kind === "image";
  });
  if (!hasVisualFootage) {
    throw new Error("Select at least one video or image before generating with footage.");
  }
}

export function reviewGatesForDraft(draft: BriefDraft): GateableGenerationStageType[] {
  const reviewGates = new Set<GateableGenerationStageType>(draft.reviewGates);
  if (draft.targetLengthSec > LONG_VIDEO_PLANNING_REVIEW_THRESHOLD_SEC) {
    reviewGates.add(LONG_VIDEO_POST_PLAN_REVIEW_GATE);
  }
  return [...reviewGates];
}

/**
 * Create the project, kick off a prompt generation run, and return the ids the
 * shell needs to poll. Throws on any API failure or a missing run id so the
 * caller can surface the error.
 */
export async function createAndStartRun(
  draft: BriefDraft,
  options: CreateAndStartRunOptions = {}
): Promise<StartRunResult> {
  assertUploadDraftHasVisualFootage(draft);
  if (options.enforceGuestRunLimit) {
    assertGuestRunAllowed();
  }

  const brief = briefInputFromDraft(draft);
  const reviewGates = reviewGatesForDraft(draft);

  const projectInput = {
    ...(draft.projectName.trim() ? { name: draft.projectName.trim() } : {}),
    brief,
    posterProvider: draft.provider,
  };
  const { project, briefVersion } = await v1Api.createProject(projectInput);

  if (draft.footageChoice === "upload") {
    if (!briefVersion?.id) {
      throw new Error("Project was created without a brief version.");
    }
    const assetIds = await registerSelectedFootage(project.id, draft);
    const { runId } = await v1Api.startUploadedFootageGenerationRun(project.id, {
      briefVersionId: briefVersion.id,
      assetIds,
      mode: compositionModeFromDraft(draft),
      allowGeneratedGapFill: true,
      reviewGates,
      showCaptions: draft.showCaptions,
    });

    if (!runId) {
      throw new Error("Generation started without a run ID.");
    }

    if (options.enforceGuestRunLimit) {
      recordGuestRunStarted();
    }
    return { projectId: project.id, runId };
  }

  const effectiveSeedKind =
    draft.provider === "gemini" ? "video" : draft.seedKind;

  const { runId } = await v1Api.startPromptGenerationRun(project.id, {
    brief,
    ...(briefVersion?.id ? { briefVersionId: briefVersion.id } : {}),
    mode: compositionModeFromDraft(draft),
    allowGeneratedGapFill: true,
    provider: draft.provider,
    reviewGates,
    showCaptions: draft.showCaptions,
    seedAsset: {
      kind: effectiveSeedKind,
      provider: draft.provider,
      prompt: draft.goal.trim(),
      description: draft.goal.trim(),
      durationSec: effectiveSeedKind === "image" ? 4 : 8,
      size: draft.seedSize,
      preflightReviewIterations: 1,
    },
  });

  if (!runId) {
    throw new Error("Generation started without a run ID.");
  }

  if (options.enforceGuestRunLimit) {
    recordGuestRunStarted();
  }
  return { projectId: project.id, runId };
}
