import { createDurableOrchestratorJobWriter, startDurableJobHeartbeat, type OrchestratorJobWriter } from "@/lib/orchestrator/job-gateway";
import { scheduleOrchestratorResume } from "@/lib/orchestrator/schedule-resume";
import type { AuthContext } from "@/lib/api/v1/auth";
import { createGeneratedAsset as realCreateGeneratedAsset } from "@/lib/api/v1/generated-assets";
import {
  getActiveProjectScopedAsset as realGetActiveProjectScopedAsset,
  selectGeneratedBeatClipAsset as realSelectGeneratedBeatClipAsset,
} from "@/lib/api/v1/store";
import type { GraphAssetInput } from "@/lib/api/v1/asset-graph";
import type { GenerateClipJobBeat } from "./generate-clip";

type VideoProvider =
  | "openai"
  | "gemini"
  | "runway"
  | "ltx"
  | "kling"
  | "seedance"
  | "xai"
  | "nvidia_api_catalog"
  | "mock";

export interface GenerateClipJobDeps {
  createGeneratedAsset: typeof realCreateGeneratedAsset;
  getActiveProjectScopedAsset: typeof realGetActiveProjectScopedAsset;
  selectGeneratedBeatClipAsset: typeof realSelectGeneratedBeatClipAsset;
  jobs?: Pick<OrchestratorJobWriter, "setStep" | "succeed" | "fail"> &
    Partial<Pick<OrchestratorJobWriter, "reportProgress">>;
  enqueueOrchestratorDispatch?: (runId: string, workspaceId: string) => Promise<unknown>;
}

const defaultDeps: GenerateClipJobDeps = {
  createGeneratedAsset: realCreateGeneratedAsset,
  getActiveProjectScopedAsset: realGetActiveProjectScopedAsset,
  selectGeneratedBeatClipAsset: realSelectGeneratedBeatClipAsset,
};

function localAuth(workspaceId: string): AuthContext {
  return {
    mode: "local",
    actor: { id: "orchestrator", type: "local" },
    workspaceId,
    isLocal: true,
  };
}

async function resume(
  deps: GenerateClipJobDeps,
  runId: string,
  workspaceId: string
): Promise<void> {
  await scheduleOrchestratorResume({ runId, workspaceId, enqueue: deps.enqueueOrchestratorDispatch });
}

function assetIdsFromResult(result: Awaited<ReturnType<typeof realCreateGeneratedAsset>>): string[] {
  const job = result.body.job as { result?: { assetIds?: unknown } } | undefined;
  const ids = job?.result?.assetIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

function graphInputsForBeat(beat: GenerateClipJobBeat): GraphAssetInput[] {
  return [
    {
      assetId: beat.keyframeAssetId,
      relation: "input",
      role: "beat_keyframe",
      position: 0,
      ...(beat.keyframeContentHash ? { contentHash: beat.keyframeContentHash } : {}),
    },
  ];
}

async function generateClipForBeat(input: {
  deps: GenerateClipJobDeps;
  auth: AuthContext;
  projectId: string;
  beat: GenerateClipJobBeat;
  provider?: VideoProvider;
  model?: string;
  orchestratorRunId?: string;
  sessionClaimGeneration?: number;
}): Promise<string[]> {
  const existingClip = await input.deps.getActiveProjectScopedAsset({
    workspaceId: input.auth.workspaceId,
    projectId: input.projectId,
    slotRole: `beat_clip:${input.beat.beatId}`,
    expectedRole: "beat_clip",
  });
  if (existingClip) return [existingClip.id];

  const result = await input.deps.createGeneratedAsset({
    auth: input.auth,
    projectId: input.projectId,
    body: {
      kind: "video",
      prompt: input.beat.prompt,
      description: input.beat.prompt,
      durationSec: input.beat.durationSec,
      seconds: input.beat.durationSec,
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.model ? { model: input.model } : {}),
      beatId: input.beat.beatId,
      assetRole: "beat_clip",
      // Stable handle derived from the planned beat (namespaced vs. the keyframe).
      name: `Clip — ${input.beat.beatId}`,
      slug: `clip-${input.beat.beatId}`,
      referenceAssetIds: [input.beat.keyframeAssetId],
      graphInputs: graphInputsForBeat(input.beat),
      ...(input.orchestratorRunId ? { runId: input.orchestratorRunId } : {}),
    },
    ...(input.sessionClaimGeneration !== undefined
      ? { sessionClaimGeneration: input.sessionClaimGeneration }
      : {}),
  });

  const assetIds = assetIdsFromResult(result);
  for (const assetId of assetIds) {
    if (input.sessionClaimGeneration === undefined) {
      await input.deps.selectGeneratedBeatClipAsset({
        workspaceId: input.auth.workspaceId,
        projectId: input.projectId,
        assetId,
        beatId: input.beat.beatId,
      });
    }
  }
  return assetIds;
}

export interface GenerateClipJobInput {
  jobId: string;
  workspaceId: string;
  projectId: string;
  orchestratorRunId?: string;
  sessionClaimGeneration?: number;
  beats: GenerateClipJobBeat[];
  skippedBeatIds?: string[];
  provider?: VideoProvider;
  model?: string;
}

export async function runGenerateClipJob(
  input: GenerateClipJobInput,
  deps: Partial<GenerateClipJobDeps> = {}
): Promise<void> {
  const d = { ...defaultDeps, ...deps };
  const jobs = d.jobs ?? createDurableOrchestratorJobWriter(input.workspaceId, input.projectId);
  const stopHeartbeat = startDurableJobHeartbeat(jobs, input.jobId);
  try {
    const totalItems = input.beats.length;
    await jobs.setStep(input.jobId, "generating_assets", {
      completedItems: 0,
      totalItems,
      provider: input.provider,
      percent: totalItems === 0 ? 100 : 0,
    });
    const auth = localAuth(input.workspaceId);
    const generatedAssetIds: string[] = [];

    for (let index = 0; index < input.beats.length; index += 1) {
      const beat = input.beats[index];
      await jobs.reportProgress?.(input.jobId, {
        currentItem: { id: beat.beatId, label: `Clip ${index + 1}`, index: index + 1 },
        message: `Generating clip ${index + 1} of ${totalItems}`,
      });
      const assetIds = await generateClipForBeat({
        deps: d,
        auth,
        projectId: input.projectId,
        beat,
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.orchestratorRunId ? { orchestratorRunId: input.orchestratorRunId } : {}),
        ...(input.sessionClaimGeneration !== undefined
          ? { sessionClaimGeneration: input.sessionClaimGeneration }
          : {}),
      });
      if (assetIds.length === 0) {
        throw new Error(`Clip generation returned no assets for ${beat.beatId}.`);
      }
      generatedAssetIds.push(...assetIds);
      const completedItems = index + 1;
      await jobs.reportProgress?.(input.jobId, {
        completedItems,
        totalItems,
        percent: totalItems === 0 ? 100 : Math.round((completedItems / totalItems) * 100),
        lastProgressAt: new Date().toISOString(),
      });
    }

    await jobs.succeed(input.jobId, {
      assetIds: generatedAssetIds,
      skippedBeatIds: input.skippedBeatIds ?? [],
    });
  } catch (err) {
    await jobs.fail(input.jobId, {
      code: "job_failed",
      message: err instanceof Error ? err.message : String(err),
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
