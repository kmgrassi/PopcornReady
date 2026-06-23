import { agentApiStore, type AgentApiStore } from "@/lib/agent-api/jobs";
import type { AuthContext } from "@/lib/api/v1/auth";
import { generateBeatKeyframe as realGenerateBeatKeyframe } from "@/lib/api/v1/beats";
import {
  getActiveProjectScopedAsset as realGetActiveProjectScopedAsset,
  getActiveProjectVisualAnchorPlan as realGetActiveProjectVisualAnchorPlan,
  getAsset as realGetAsset,
  selectGeneratedBeatKeyframeAsset as realSelectGeneratedBeatKeyframeAsset,
  type V1Asset,
  type VisualAnchorPlan,
  type VisualAnchorPlanItem,
} from "@/lib/api/v1/store";
import type { GraphAssetInput } from "@/lib/api/v1/asset-graph";
import { buildKeyframePrompt } from "@/lib/generative/keyframe";
import type { Beat, EditPlan } from "@popcorn/shared/types";
import { planBeats } from "@popcorn/shared/types";
import type { ProjectStoryboard } from "@popcorn/shared/v1/types";
import { createLogger } from "@/lib/v1/logger";

type KeyframeImageProvider = "openai" | "ideogram" | "gemini" | "mock";

export interface GenerateKeyframeJobDeps {
  getActiveProjectScopedAsset: typeof realGetActiveProjectScopedAsset;
  getActiveProjectVisualAnchorPlan: typeof realGetActiveProjectVisualAnchorPlan;
  getAsset: typeof realGetAsset;
  generateBeatKeyframe: typeof realGenerateBeatKeyframe;
  selectGeneratedBeatKeyframeAsset: typeof realSelectGeneratedBeatKeyframeAsset;
  jobs: Pick<AgentApiStore, "setStep" | "succeed" | "fail">;
  resumeOrchestratorRun?: (
    runId: string,
    deps: { workspaceId: string }
  ) => Promise<unknown>;
}

const defaultDeps: GenerateKeyframeJobDeps = {
  getActiveProjectScopedAsset: realGetActiveProjectScopedAsset,
  getActiveProjectVisualAnchorPlan: realGetActiveProjectVisualAnchorPlan,
  getAsset: realGetAsset,
  generateBeatKeyframe: realGenerateBeatKeyframe,
  selectGeneratedBeatKeyframeAsset: realSelectGeneratedBeatKeyframeAsset,
  jobs: agentApiStore,
};
const logger = createLogger();

function localAuth(workspaceId: string): AuthContext {
  return {
    mode: "local",
    actor: { id: "orchestrator", type: "local" },
    workspaceId,
    isLocal: true,
  };
}

async function resume(
  deps: GenerateKeyframeJobDeps,
  runId: string,
  workspaceId: string
): Promise<void> {
  const fn =
    deps.resumeOrchestratorRun ??
    (await import("@/lib/orchestrator/engine")).resumeOrchestratorRun;
  await fn(runId, { workspaceId });
}

function assetIdsFromResult(result: Awaited<ReturnType<typeof realGenerateBeatKeyframe>>): string[] {
  const job = result.body.job as { result?: { assetIds?: unknown } } | undefined;
  const ids = job?.result?.assetIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

function storyboardTileByPlanBeat(
  plan: EditPlan,
  storyboard: ProjectStoryboard
): Map<string, string> {
  const map = new Map<string, string>();
  for (let sceneIndex = 0; sceneIndex < plan.scenes.length; sceneIndex += 1) {
    const scene = plan.scenes[sceneIndex];
    const sbScene = storyboard.scenes.find((candidate) => candidate.sceneIndex === sceneIndex);
    for (let beatIndex = 0; beatIndex < scene.beats.length; beatIndex += 1) {
      const beat = scene.beats[beatIndex];
      const beatId = beat.id ?? beat.name;
      const sbBeat = sbScene?.beats.find((candidate) => candidate.beatIndex === beatIndex);
      const selectedPanel =
        sbBeat?.panels.find((panel) => panel.isSelected && panel.imageAssetId) ??
        sbBeat?.panels.find((panel) => panel.imageAssetId);
      if (selectedPanel?.imageAssetId) map.set(beatId, selectedPanel.imageAssetId);
    }
  }
  return map;
}

function mentionsMinor(beat: Beat, anchors: VisualAnchorPlanItem[]): boolean {
  return /\b(baby|boy|child|girl|kid|minor|teen|toddler|youth)\b/i.test(
    `${beat.name} ${beat.intent} ${anchors
      .map((anchor) => `${anchor.label} ${anchor.description}`)
      .join(" ")}`
  );
}

function providerForBeat(
  beat: Beat,
  anchors: VisualAnchorPlanItem[],
  requestedProvider?: KeyframeImageProvider
): KeyframeImageProvider | undefined {
  if (mentionsMinor(beat, anchors)) return "gemini";
  return requestedProvider;
}

function graphInputForAsset(
  asset: Pick<V1Asset, "id" | "role" | "contentHash">,
  relation: GraphAssetInput["relation"],
  position: number
): GraphAssetInput {
  return {
    assetId: asset.id,
    relation,
    role: asset.role,
    position,
    ...(asset.contentHash ? { contentHash: asset.contentHash } : {}),
  };
}

async function activeAnchorAssets(input: {
  deps: GenerateKeyframeJobDeps;
  workspaceId: string;
  projectId: string;
  beatId: string;
  visualAnchorPlan?: VisualAnchorPlan;
}): Promise<{ anchor: VisualAnchorPlanItem; asset: V1Asset }[]> {
  const matching = (input.visualAnchorPlan?.anchors ?? []).filter((anchor) =>
    anchor.sourceBeatIds.includes(input.beatId)
  );
  const assets: { anchor: VisualAnchorPlanItem; asset: V1Asset }[] = [];
  for (const anchor of matching) {
    const role = anchor.kind === "character" ? "character_anchor" : "scene_anchor";
    const asset = await input.deps.getActiveProjectScopedAsset({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      slotRole: `${role}:${anchor.id}`,
      expectedRole: role,
    });
    if (asset?.status === "ready") assets.push({ anchor, asset });
  }
  return assets;
}

export interface GenerateKeyframeJobInput {
  jobId: string;
  workspaceId: string;
  projectId: string;
  orchestratorRunId?: string;
  plan: EditPlan;
  planAssetId: string;
  planContentHash: string;
  storyboard: ProjectStoryboard;
  provider?: KeyframeImageProvider;
}

export async function runGenerateKeyframeJob(
  input: GenerateKeyframeJobInput,
  deps: Partial<GenerateKeyframeJobDeps> = {}
): Promise<void> {
  const d = { ...defaultDeps, ...deps };
  const jobLogger = logger.child({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    runId: input.orchestratorRunId,
    jobId: input.jobId,
  });
  try {
    await d.jobs.setStep(input.jobId, "generating_assets");
    const auth = localAuth(input.workspaceId);
    const activeVisualAnchors = await d.getActiveProjectVisualAnchorPlan(input.projectId);
    const tileByBeat = storyboardTileByPlanBeat(input.plan, input.storyboard);
    const generatedAssetIds: string[] = [];
    const skippedAssetIds: string[] = [];
    const beats = planBeats(input.plan);
    jobLogger.info("generate_keyframe_job.started", {
      planAssetId: input.planAssetId,
      storyboardId: input.storyboard.id,
      beatCount: beats.length,
      storyboardTileCount: tileByBeat.size,
      visualAnchorCount: activeVisualAnchors?.visualAnchorPlan.anchors.length ?? 0,
    });

    for (let index = 0; index < beats.length; index += 1) {
      const beat = beats[index];
      const beatId = beat.id ?? beat.name;
      const existing = await d.getActiveProjectScopedAsset({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        slotRole: `beat_keyframe:${beatId}`,
        expectedRole: "beat_keyframe",
      });
      if (existing?.status === "ready") {
        jobLogger.info("generate_keyframe_job.beat_skipped_existing", {
          beatId,
          existingAssetId: existing.id,
          existingStatus: existing.status,
        });
        skippedAssetIds.push(existing.id);
        continue;
      }

      const anchors = await activeAnchorAssets({
        deps: d,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        beatId,
        ...(activeVisualAnchors?.visualAnchorPlan
          ? { visualAnchorPlan: activeVisualAnchors.visualAnchorPlan }
          : {}),
      });
      const tileAssetId = tileByBeat.get(beatId);
      const tileAsset = tileAssetId
        ? await d.getAsset(input.workspaceId, input.projectId, tileAssetId)
        : null;
      const storyboardAsset = tileAsset?.role === "beat_storyboard" ? tileAsset : null;
      if (tileAsset && !storyboardAsset) {
        jobLogger.warn("generate_keyframe_job.storyboard_tile_wrong_role", {
          beatId,
          tileAssetId,
          tileRole: tileAsset.role,
          tileKind: tileAsset.kind,
          tileStatus: tileAsset.status,
        });
      } else if (!tileAssetId) {
        jobLogger.warn("generate_keyframe_job.storyboard_tile_missing", { beatId });
      }
      const useStoryboardReference = Boolean(storyboardAsset && anchors.length > 0);
      const graphInputs: GraphAssetInput[] = [
        {
          assetId: input.planAssetId,
          relation: "input",
          role: "plan",
          position: 0,
          ...(input.planContentHash ? { contentHash: input.planContentHash } : {}),
        },
        ...anchors.map(({ asset }, anchorIndex) =>
          graphInputForAsset(asset, "anchor", anchorIndex + 1)
        ),
        ...(storyboardAsset
          ? [graphInputForAsset(storyboardAsset, "input", anchors.length + 1)]
          : []),
      ];
      const prompt = buildKeyframePrompt({
        beat,
        beatIndex: index,
        totalBeats: beats.length,
        style: input.plan.style,
        aspectRatio: input.plan.aspectRatio,
        sketchSeeded: useStoryboardReference,
      });
      const anchorAssetIds = anchors.map(({ asset }) => asset.id);
      const structuralReferenceAssetIds =
        useStoryboardReference && storyboardAsset ? [storyboardAsset.id] : [];
      const provider = providerForBeat(
        beat,
        anchors.map(({ anchor }) => anchor),
        input.provider
      );
      jobLogger.info("generate_keyframe_job.beat_generating", {
        beatId,
        beatIndex: index,
        provider: provider ?? "workspace_default",
        anchorAssetIds,
        storyboardAssetId: storyboardAsset?.id,
        structuralReferenceAssetIds,
        graphInputRoles: graphInputs.map((graphInput) => graphInput.role),
        useStoryboardReference,
      });

      const result = await d.generateBeatKeyframe({
        auth,
        projectId: input.projectId,
        beatId,
        body: {
          prompt,
          ...(provider ? { provider } : {}),
          assetRole: "beat_keyframe",
          // Display name + a stable, agent-referenceable handle derived from the
          // planned beat (namespaced so a beat's keyframe and clip don't collide).
          name: `Keyframe — ${beat.name}`,
          slug: `keyframe-${beatId}`,
          anchorIds: anchorAssetIds,
          structuralReferenceAssetIds,
          graphInputs,
          ...(input.orchestratorRunId ? { runId: input.orchestratorRunId } : {}),
        },
      });
      const assetIds = assetIdsFromResult(result);
      jobLogger.info("generate_keyframe_job.beat_generation_result", {
        beatId,
        status: result.status,
        assetIds,
      });
      if (assetIds.length === 0) {
        throw new Error(`Keyframe generation returned no assets for ${beatId}.`);
      }
      for (const assetId of assetIds) {
        try {
          await d.selectGeneratedBeatKeyframeAsset({
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            beatId,
            assetId,
          });
        } catch (err) {
          jobLogger.error("generate_keyframe_job.selection_failed", {
            beatId,
            assetId,
            error: { message: err instanceof Error ? err.message : String(err) },
          });
          throw err;
        }
        jobLogger.info("generate_keyframe_job.selection_applied", {
          beatId,
          assetId,
          slotRole: `beat_keyframe:${beatId}`,
        });
        generatedAssetIds.push(assetId);
      }
    }

    await d.jobs.succeed(input.jobId, { assetIds: generatedAssetIds, skippedAssetIds });
    jobLogger.info("generate_keyframe_job.succeeded", {
      generatedAssetIds,
      skippedAssetIds,
    });
  } catch (err) {
    jobLogger.error("generate_keyframe_job.failed", {
      error: { message: err instanceof Error ? err.message : String(err) },
    });
    await d.jobs.fail(input.jobId, {
      code: "job_failed",
      message: err instanceof Error ? err.message : String(err),
      requestId: "",
    });
  } finally {
    if (input.orchestratorRunId) {
      try {
        await resume(d, input.orchestratorRunId, input.workspaceId);
      } catch {
        // best-effort: durable run sweepers can resume a parked run later.
      }
    }
  }
}
