import { createHash } from "node:crypto";
import {
  planBeats,
  singleSceneFromBeats,
  type ShotPlan,
} from "@popcorn/shared/types";
import { ApiError } from "@/core/errors";
import { planEdit } from "@/lib/agent";
import {
  addPooledRerunDataAsset,
  coerceShotPlanContent,
  getAsset,
  getRerunDataAssetSnapshot,
  type StoryBlueprint,
  type V1Asset,
} from "@/lib/api/v1/store";
import {
  releaseOrchestratorBudget,
  settleOrchestratorBudget,
} from "@/lib/api/v1/orchestrator-budget-controls";
import { sumActionCostUsd } from "@/lib/api/v1/model-call-costs";
import { withLlmCostRecording } from "@/lib/api/v1/llm-costs";
import type { VideoBrief } from "@/lib/api/v1/schemas";
import { deriveStoryBlueprint } from "@/lib/orchestrator-tools/develop-story-blueprint";
import { assembleTimelineDraft } from "@/lib/orchestrator-tools/assemble-timeline";
import {
  critiqueTimelineDraft,
  isTimeline,
} from "@/lib/orchestrator-tools/critique-timeline";
import type { GraphAssetInput } from "@/lib/api/v1/asset-graph";
import type {
  RootAssemblyRequest,
  RootCritiqueRequest,
  RootRerunExecutorServices,
  RootServiceResult,
  RootStorySnapshotRequest,
} from "./rerun-root-executors";

const STORY_MODEL_CEILING_USD = 0.2;
const ASSEMBLY_MODEL_CEILING_USD = 0.12;
const CRITIQUE_MODEL_CEILING_USD = 0.1;

function deterministicUuid(namespace: string, key: string): string {
  const digest = createHash("sha256")
    .update(`${namespace}\u0000${key}`)
    .digest("hex");
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `${((parseInt(digest[16]!, 16) & 0x3) | 0x8).toString(16)}${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join("-");
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError("validation_failed", message);
  }
  return value as Record<string, unknown>;
}

function videoBrief(value: unknown): VideoBrief {
  const source = record(value, "Pinned brief is not structured.");
  if (
    typeof source.goal !== "string" ||
    typeof source.targetLengthSec !== "number" ||
    !["9:16", "16:9", "1:1"].includes(String(source.aspectRatio))
  ) {
    throw new ApiError("validation_failed", "Pinned brief is not a canonical video brief.");
  }
  return source as unknown as VideoBrief;
}

export function preserveStablePlanIds(
  source: ShotPlan,
  revised: ShotPlan
): ShotPlan {
  const knownSceneIds = new Set(source.scenes.map((scene) => scene.id));
  const knownBeatIds = new Set(
    planBeats(source).flatMap((beat) => beat.id ? [beat.id] : [])
  );
  const sceneIds = new Set<string>();
  const beatIds = new Set<string>();
  const stableId = (
    kind: "scene" | "beat",
    candidate: string | undefined,
    known: Set<string>,
    discriminator: string
  ): string => {
    if (candidate && known.has(candidate)) return candidate;
    if (!candidate?.startsWith("new:")) {
      throw new ApiError(
        "validation_failed",
        `Canonical story revision returned an unknown ${kind} identity.`
      );
    }
    return `${kind}_new_${createHash("sha256")
      .update(`${candidate}\u0000${discriminator}`)
      .digest("hex")
      .slice(0, 16)}`;
  };
  const scenes = revised.scenes.map((scene, sceneIndex) => {
    const sceneId = stableId(
      "scene",
      scene.id,
      knownSceneIds,
      `${sceneIndex}:${scene.name}`
    );
    if (sceneIds.has(sceneId)) {
      throw new ApiError(
        "validation_failed",
        "Canonical story revision returned a duplicate scene identity."
      );
    }
    sceneIds.add(sceneId);
    const beats = scene.beats.map((beat, beatIndex) => {
      const beatId = stableId(
        "beat",
        beat.id,
        knownBeatIds,
        `${sceneId}:${beatIndex}:${beat.name}`
      );
      if (beatIds.has(beatId)) {
        throw new ApiError(
          "validation_failed",
          "Canonical story revision returned a duplicate beat identity."
        );
      }
      beatIds.add(beatId);
      return { ...beat, id: beatId };
    });
    return { ...scene, id: sceneId, beats };
  });
  // Existing IDs are meaningful identities, not positions. The model receives
  // the source plan (including IDs) and must return the same ID for an entity it
  // retains. New entities must use an explicit `new:` marker; the server mints
  // their durable IDs. Removed entities simply disappear. Never transfer the ID
  // that happened to occupy the same index.
  return { ...revised, scenes };
}

export function validateStableTarget(
  plan: ShotPlan,
  request: Pick<RootStorySnapshotRequest, "binding">
): void {
  const target = request.binding.target;
  if (
    target.kind === "scene" &&
    !plan.scenes.some((scene) => scene.id === target.sceneId)
  ) {
    throw new ApiError(
      "validation_failed",
      "Canonical story revision did not preserve the requested scene identity."
    );
  }
  if (
    target.kind === "beat" &&
    !planBeats(plan).some((beat) => beat.id === target.beatId)
  ) {
    throw new ApiError(
      "validation_failed",
      "Canonical story revision did not preserve the requested beat identity."
    );
  }
}

export async function existingRootResult(input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
  kind: "beat" | "plan" | "story_blueprint" | "composite" | "critique";
  role: string;
  primitiveActionId: string;
}, deps: {
  getSnapshot: typeof getRerunDataAssetSnapshot;
  sumCost: typeof sumActionCostUsd;
} = {
  getSnapshot: getRerunDataAssetSnapshot,
  sumCost: sumActionCostUsd,
}): Promise<RootServiceResult | null> {
  try {
    const asset = await deps.getSnapshot(input);
    if (asset.kind !== input.kind || asset.role !== input.role) {
      throw new ApiError(
        "idempotency_conflict",
        "Root executor replay resolved to a different output contract."
      );
    }
    return {
      assetId: asset.id,
      intrinsicRole: input.role,
      actualCostUsd: await deps.sumCost(input.primitiveActionId),
    };
  } catch (error) {
    if (error instanceof ApiError && error.code === "not_found") return null;
    throw error;
  }
}

function graphInputs(assets: V1Asset[]): GraphAssetInput[] {
  return assets.map((asset, position) => ({
    assetId: asset.id,
    relation: "input",
    role: asset.role ?? asset.kind,
    position,
    ...(asset.contentHash ? { contentHash: asset.contentHash } : {}),
  }));
}

async function stageStorySnapshot(
  request: RootStorySnapshotRequest
): Promise<RootServiceResult> {
  if (!request.pointerPin.expectedSnapshotAssetId) {
    throw new ApiError(
      "validation_failed",
      "Story revision requires an existing pinned snapshot to revise."
    );
  }
  const assetId = deterministicUuid("rerun-story-snapshot", request.idempotencyKey);
  const expectedKind =
    request.binding.target.kind === "project"
      ? "story_blueprint"
      : request.binding.target.kind === "beat"
        ? "beat"
        : "plan";
  const replay = await existingRootResult({
    workspaceId: request.workspaceId,
    projectId: request.projectId,
    assetId,
    kind: expectedKind,
    role: request.binding.role,
    primitiveActionId: request.primitiveActionId,
  });
  if (replay) return replay;

  const predecessor = await getRerunDataAssetSnapshot({
    workspaceId: request.workspaceId,
    projectId: request.projectId,
    assetId: request.pointerPin.expectedSnapshotAssetId,
  });
  if (
    (request.binding.target.kind === "project" && predecessor.kind !== "story_blueprint") ||
    (request.binding.target.kind !== "project" &&
      request.binding.target.kind !== "beat" &&
      predecessor.kind !== "plan") ||
    (request.binding.target.kind === "beat" &&
      predecessor.kind !== "beat" &&
      predecessor.kind !== "plan")
  ) {
    throw new ApiError("stale_proposal", "Pinned story snapshot kind changed.");
  }

  const predecessorAsset = await getAsset(
    request.workspaceId,
    request.projectId,
    predecessor.id
  );
  let content: StoryBlueprint | ShotPlan | Record<string, unknown>;
  let actualCostUsd = 0;
  const causalAssets = [predecessorAsset];

  if (request.binding.target.kind === "project") {
    const briefInput = predecessorAsset.graphInputs?.find((input) => input.role === "brief");
    const approvedPin = briefInput
      ? request.approvedAssetPins.find((pin) => pin.assetId === briefInput.assetId)
      : null;
    if (
      !briefInput ||
      !approvedPin ||
      (briefInput.contentHash &&
        approvedPin.contentHash !== briefInput.contentHash)
    ) {
      throw new ApiError(
        "stale_proposal",
        "Story revision requires the exact pinned brief used by its predecessor."
      );
    }
    const brief = await getRerunDataAssetSnapshot({
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      assetId: briefInput.assetId,
    });
    if (brief.kind !== "brief") {
      throw new ApiError("stale_proposal", "Pinned story input is not a brief.");
    }
    content = deriveStoryBlueprint(videoBrief(brief.content), request.instruction);
    causalAssets.push(
      await getAsset(request.workspaceId, request.projectId, brief.id)
    );
  } else {
    const sourceBeat =
      predecessor.kind === "beat"
        ? record(predecessor.content, "Pinned beat snapshot is malformed.")
        : null;
    const beatSource = sourceBeat ?? {};
    const beatDuration =
      typeof beatSource.durationSec === "number"
        ? Math.max(0.1, beatSource.durationSec)
        : 4;
    const sourcePlan = predecessor.kind === "beat"
      ? {
        targetLengthSec: beatDuration,
        style: typeof beatSource.style === "string" ? beatSource.style : "cinematic",
        aspectRatio: "16:9" as const,
        scenes: singleSceneFromBeats([{
          id: request.binding.target.kind === "beat"
            ? request.binding.target.beatId
            : String(beatSource.id ?? "beat"),
          name: typeof beatSource.name === "string" ? beatSource.name : "Beat",
          intent: typeof beatSource.intent === "string" ? beatSource.intent : "",
          durationSec: beatDuration,
        }]),
      }
      : coerceShotPlanContent(predecessor.content);
    if (!sourcePlan) {
      throw new ApiError(
        "validation_failed",
        "Pinned story target does not contain a canonical shot plan."
      );
    }
    validateStableTarget(sourcePlan, request);
    const revised = await withLlmCostRecording(
      {
        projectId: request.projectId,
        runId: request.rootRunId,
        actionId: request.primitiveActionId,
      },
      () => planEdit({
        goal:
          planBeats(sourcePlan).map((beat) => beat.intent).filter(Boolean).join(" ") ||
          "Revise the approved story plan.",
        targetLengthSec: sourcePlan.targetLengthSec,
        style: sourcePlan.style,
        aspectRatio: sourcePlan.aspectRatio,
        narrativeContext: JSON.stringify(sourcePlan),
        feedback: [
          request.instruction,
          "Preserve the exact id of every existing scene and beat you retain, even when reordering. For a genuinely new entity, use a unique temporary id beginning with `new:`. Never reuse a removed entity's id for different content.",
        ].join("\n\n"),
        storyContext: null,
        preserveStableIds: true,
      })
    );
    actualCostUsd = await sumActionCostUsd(request.primitiveActionId);
    const stable = preserveStablePlanIds(sourcePlan, revised);
    validateStableTarget(stable, request);
    const target = request.binding.target;
    content =
      target.kind === "beat"
        ? record(
          planBeats(stable).find(
            (beat) => beat.id === target.beatId
          ),
          "Canonical story revision omitted the requested beat."
        )
        : stable;
  }

  await addPooledRerunDataAsset({
    id: assetId,
    workspaceId: request.workspaceId,
    projectId: request.projectId,
    kind: expectedKind,
    contentSchemaKind: expectedKind,
    role: request.binding.role,
    content,
    graphInputs: graphInputs(causalAssets),
    createdByActionId: request.primitiveActionId,
  });
  return { assetId, intrinsicRole: request.binding.role, actualCostUsd };
}

async function assembleProspectiveCut(
  request: RootAssemblyRequest
): Promise<RootServiceResult> {
  const assetId = deterministicUuid("rerun-prospective-cut", request.idempotencyKey);
  const replay = await existingRootResult({
    workspaceId: request.workspaceId,
    projectId: request.projectId,
    assetId,
    kind: "composite",
    role: request.binding.role,
    primitiveActionId: request.primitiveActionId,
  });
  if (replay) return replay;

  const candidateIds = [...new Set([
    ...request.prospectiveAssets.map((asset) => asset.assetId),
    ...request.preservedAssetIds,
  ])];
  const assets = await Promise.all(
    candidateIds.map((candidateId) =>
      getAsset(request.workspaceId, request.projectId, candidateId)
    )
  );
  let planSnapshot: Awaited<ReturnType<typeof getRerunDataAssetSnapshot>> | null = null;
  for (const candidateId of candidateIds) {
    try {
      const candidate = await getRerunDataAssetSnapshot({
        workspaceId: request.workspaceId,
        projectId: request.projectId,
        assetId: candidateId,
      });
      if (candidate.kind === "plan") {
        planSnapshot = candidate;
        break;
      }
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== "not_found") throw error;
    }
  }
  if (!planSnapshot) {
    throw new ApiError(
      "validation_failed",
      "Prospective assembly requires an exact approved plan snapshot."
    );
  }
  const planAsset = assets.find((asset) => asset.id === planSnapshot.id);
  if (!planAsset) {
    throw new ApiError("validation_failed", "Prospective plan asset is unavailable.");
  }
  const plan = coerceShotPlanContent(planSnapshot.content);
  if (!plan) {
    throw new ApiError("validation_failed", "Prospective assembly plan is malformed.");
  }
  const mediaAssets = assets.filter(
    (asset) => asset.kind === "video" || asset.kind === "audio"
  );
  const assembled = await withLlmCostRecording(
    {
      projectId: request.projectId,
      runId: request.rootRunId,
      actionId: request.primitiveActionId,
    },
    () => assembleTimelineDraft({
      plan,
      planAsset: {
        assetId: planAsset.id,
        contentHash: planAsset.contentHash ?? "",
      },
      assets: mediaAssets,
      causalAssets: assets.filter((asset) => asset.id !== planAsset.id),
      goal: request.instruction,
    })
  );
  const actualCostUsd = await sumActionCostUsd(request.primitiveActionId);
  await addPooledRerunDataAsset({
    id: assetId,
    workspaceId: request.workspaceId,
    projectId: request.projectId,
    kind: "composite",
    contentSchemaKind: "timeline",
    role: request.binding.role,
    content: assembled.timeline,
    graphInputs: assembled.graphInputs,
    createdByActionId: request.primitiveActionId,
  });
  return { assetId, intrinsicRole: request.binding.role, actualCostUsd };
}

async function critiqueProspectiveCut(
  request: RootCritiqueRequest
): Promise<RootServiceResult> {
  const assetId = deterministicUuid("rerun-prospective-critique", request.idempotencyKey);
  const replay = await existingRootResult({
    workspaceId: request.workspaceId,
    projectId: request.projectId,
    assetId,
    kind: "critique",
    role: request.binding.role,
    primitiveActionId: request.primitiveActionId,
  });
  if (replay) return replay;

  const cut = await getRerunDataAssetSnapshot({
    workspaceId: request.workspaceId,
    projectId: request.projectId,
    assetId: request.prospectiveCutAssetId,
  });
  if (cut.kind !== "composite" || !isTimeline(cut.content)) {
    throw new ApiError(
      "validation_failed",
      "Prospective critique target is not a canonical timeline."
    );
  }
  const timeline = cut.content;
  const cutAsset = await getAsset(
    request.workspaceId,
    request.projectId,
    cut.id
  );
  const referencedIds = [
    ...new Set(cutAsset.graphInputs?.map((input) => input.assetId) ?? []),
  ];
  const referencedAssets = await Promise.all(
    referencedIds.map((referencedId) =>
      getAsset(request.workspaceId, request.projectId, referencedId)
    )
  );
  const critique = await withLlmCostRecording(
    {
      projectId: request.projectId,
      runId: request.rootRunId,
      actionId: request.primitiveActionId,
    },
    () => critiqueTimelineDraft({
      timeline,
      assets: referencedAssets,
    })
  );
  const actualCostUsd = await sumActionCostUsd(request.primitiveActionId);
  await addPooledRerunDataAsset({
    id: assetId,
    workspaceId: request.workspaceId,
    projectId: request.projectId,
    kind: "critique",
    contentSchemaKind: "critique",
    role: request.binding.role,
    content: { timelineId: cut.id, report: critique.report },
    graphInputs: [{
      assetId: cut.id,
      relation: "input",
      role: "prospective_cut",
      position: 0,
      ...(cut.contentHash ? { contentHash: cut.contentHash } : {}),
    }],
    createdByActionId: request.primitiveActionId,
  });
  return { assetId, intrinsicRole: request.binding.role, actualCostUsd };
}

export const productionRootRerunServices: RootRerunExecutorServices = {
  stageStorySnapshot,
  assembleProspectiveCut,
  critiqueProspectiveCut,
  estimateStoryUsd: (request) =>
    request.binding.target.kind === "project" ? 0 : STORY_MODEL_CEILING_USD,
  estimateAssemblyUsd: () => ASSEMBLY_MODEL_CEILING_USD,
  estimateCritiqueUsd: () => CRITIQUE_MODEL_CEILING_USD,
  measuredActionCostUsd: sumActionCostUsd,
  settleBudget: settleOrchestratorBudget,
  releaseBudget: releaseOrchestratorBudget,
};
