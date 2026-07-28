import { createDurableOrchestratorJobWriter, startDurableJobHeartbeat, type OrchestratorJobWriter } from "@/lib/orchestrator/job-gateway";
import { scheduleOrchestratorResume } from "@/lib/orchestrator/schedule-resume";
import type { AuthContext } from "@/lib/api/v1/auth";
import { generateBeatKeyframe as realGenerateBeatKeyframe } from "@/lib/api/v1/beats";
import {
  getActiveProjectScopedAsset as realGetActiveProjectScopedAsset,
  getActiveProjectVisualAnchorPlan as realGetActiveProjectVisualAnchorPlan,
  getAsset as realGetAsset,
  getProjectRunGeneratedAsset as realGetProjectRunGeneratedAsset,
  selectGeneratedBeatKeyframeAsset as realSelectGeneratedBeatKeyframeAsset,
  type V1Asset,
  type VisualAnchorPlan,
  type VisualAnchorPlanItem,
} from "@/lib/api/v1/store";
import type { GraphAssetInput } from "@/lib/api/v1/asset-graph";
import { buildKeyframePrompt } from "@/lib/generative/keyframe";
import type { Beat, ShotPlan } from "@popcorn/shared/types";
import { planBeats } from "@popcorn/shared/types";
import type { ProjectStoryboard } from "@popcorn/shared/v1/types";
import { createLogger } from "@/lib/v1/logger";
import { redactError } from "@/lib/v1/redact";

type KeyframeImageProvider = "openai" | "ideogram" | "gemini" | "xai" | "mock";

export interface GenerateKeyframeJobDeps {
  getActiveProjectScopedAsset: typeof realGetActiveProjectScopedAsset;
  getActiveProjectVisualAnchorPlan: typeof realGetActiveProjectVisualAnchorPlan;
  getAsset: typeof realGetAsset;
  getProjectRunGeneratedAsset: typeof realGetProjectRunGeneratedAsset;
  generateBeatKeyframe: typeof realGenerateBeatKeyframe;
  selectGeneratedBeatKeyframeAsset: typeof realSelectGeneratedBeatKeyframeAsset;
  jobs?: Pick<OrchestratorJobWriter, "setStep" | "succeed" | "fail"> &
    Partial<Pick<OrchestratorJobWriter, "reportProgress">>;
  enqueueOrchestratorDispatch?: (runId: string, workspaceId: string) => Promise<unknown>;
}

const defaultDeps: GenerateKeyframeJobDeps = {
  getActiveProjectScopedAsset: realGetActiveProjectScopedAsset,
  getActiveProjectVisualAnchorPlan: realGetActiveProjectVisualAnchorPlan,
  getAsset: realGetAsset,
  getProjectRunGeneratedAsset: realGetProjectRunGeneratedAsset,
  generateBeatKeyframe: realGenerateBeatKeyframe,
  selectGeneratedBeatKeyframeAsset: realSelectGeneratedBeatKeyframeAsset,
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
  await scheduleOrchestratorResume({ runId, workspaceId, enqueue: deps.enqueueOrchestratorDispatch });
}

function assetIdsFromResult(result: Awaited<ReturnType<typeof realGenerateBeatKeyframe>>): string[] {
  const job = result.body.job as { result?: { assetIds?: unknown } } | undefined;
  const ids = job?.result?.assetIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

function storyboardTileByPlanBeat(
  plan: ShotPlan,
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
      const selectedPanel = sbBeat?.panels.find(
        (panel) => panel.isSelected && panel.imageAssetId
      );
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
  orchestratorRunId?: string;
  sessionClaimGeneration?: number;
  visualAnchorPlan?: VisualAnchorPlan;
}): Promise<{ anchor: VisualAnchorPlanItem; asset: V1Asset }[]> {
  const matching = (input.visualAnchorPlan?.anchors ?? []).filter((anchor) =>
    anchor.sourceBeatIds.includes(input.beatId)
  );
  const assets: { anchor: VisualAnchorPlanItem; asset: V1Asset }[] = [];
  for (const anchor of matching) {
    const role = anchor.kind === "character" ? "character_anchor" : "scene_anchor";
    const selectedAsset = await input.deps.getActiveProjectScopedAsset({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      slotRole: `${role}:${anchor.id}`,
      expectedRole: role,
    });
    const asset =
      selectedAsset ??
      (input.orchestratorRunId &&
      input.sessionClaimGeneration !== undefined
        ? await input.deps.getProjectRunGeneratedAsset({
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            orchestratorRunId: input.orchestratorRunId,
            role,
            slug: anchor.id,
          })
        : null);
    if (asset?.status === "ready") assets.push({ anchor, asset });
  }
  return assets;
}

export interface GenerateKeyframeJobInput {
  jobId: string;
  workspaceId: string;
  projectId: string;
  orchestratorRunId?: string;
  sessionClaimGeneration?: number;
  plan: ShotPlan;
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
  const jobs = d.jobs ?? createDurableOrchestratorJobWriter(input.workspaceId, input.projectId);
  const stopHeartbeat = startDurableJobHeartbeat(jobs, input.jobId);
  const jobLogger = logger.child({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    runId: input.orchestratorRunId,
    jobId: input.jobId,
  });
  try {
    const auth = localAuth(input.workspaceId);
    const activeVisualAnchors = await d.getActiveProjectVisualAnchorPlan(input.projectId);
    const tileByBeat = storyboardTileByPlanBeat(input.plan, input.storyboard);
    const generatedAssetIds: string[] = [];
    const skippedAssetIds: string[] = [];
    const beats = planBeats(input.plan);
    await jobs.setStep(input.jobId, "generating_assets", {
      completedItems: 0,
      totalItems: beats.length,
      provider: input.provider,
      percent: beats.length === 0 ? 100 : 0,
    });
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
      await jobs.reportProgress?.(input.jobId, {
        currentItem: { id: beatId, label: beat.name, index: index + 1 },
        message: `Generating keyframe ${index + 1} of ${beats.length}`,
      });
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
        await jobs.reportProgress?.(input.jobId, {
          completedItems: index + 1,
          totalItems: beats.length,
          percent: Math.round(((index + 1) / beats.length) * 100),
          lastProgressAt: new Date().toISOString(),
        });
        continue;
      }

      const anchors = await activeAnchorAssets({
        deps: d,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        beatId,
        ...(input.orchestratorRunId
          ? { orchestratorRunId: input.orchestratorRunId }
          : {}),
        ...(input.sessionClaimGeneration !== undefined
          ? { sessionClaimGeneration: input.sessionClaimGeneration }
          : {}),
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
        ...(input.sessionClaimGeneration !== undefined
          ? { sessionClaimGeneration: input.sessionClaimGeneration }
          : {}),
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
        if (input.sessionClaimGeneration === undefined) {
          try {
            await d.selectGeneratedBeatKeyframeAsset({
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              beatId,
              assetId,
            });
          } catch (err) {
            const safeError = redactError(err, { defaultCode: "selection_failed" });
            jobLogger.error("generate_keyframe_job.selection_failed", {
              beatId,
              assetId,
              error: safeError,
            });
            throw err;
          }
          jobLogger.info("generate_keyframe_job.selection_applied", {
            beatId,
            assetId,
            slotRole: `beat_keyframe:${beatId}`,
          });
        }
        generatedAssetIds.push(assetId);
      }
      await jobs.reportProgress?.(input.jobId, {
        completedItems: index + 1,
        totalItems: beats.length,
        percent: Math.round(((index + 1) / beats.length) * 100),
        lastProgressAt: new Date().toISOString(),
      });
    }

    await jobs.succeed(input.jobId, { assetIds: generatedAssetIds, skippedAssetIds });
    jobLogger.info("generate_keyframe_job.succeeded", {
      generatedAssetIds,
      skippedAssetIds,
    });
  } catch (err) {
    const safeError = redactError(err, { defaultCode: "job_failed" });
    jobLogger.error("generate_keyframe_job.failed", {
      error: safeError,
    });
    await jobs.fail(input.jobId, {
      code: safeError.code,
      message: safeError.message,
      requestId: "",
    });
  } finally {
    stopHeartbeat();
    if (input.orchestratorRunId) {
      try {
        await resume(d, input.orchestratorRunId, input.workspaceId);
      } catch {
        // best-effort: durable run sweepers can resume a parked run later.
      }
    }
  }
}
