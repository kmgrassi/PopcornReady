import { agentApiStore, type AgentApiStore } from "@/lib/agent-api/jobs";
import type { AuthContext } from "@/lib/api/v1/auth";
import { createGeneratedAsset as realCreateGeneratedAsset } from "@/lib/api/v1/generated-assets";
import {
  getActiveProjectScopedAsset as realGetActiveProjectScopedAsset,
  selectGeneratedBeatClipAsset as realSelectGeneratedBeatClipAsset,
} from "@/lib/api/v1/store";
import type { GraphAssetInput } from "@/lib/api/v1/asset-graph";
import type { GenerateClipJobBeat } from "./generate-clip";

type VideoProvider = "openai" | "gemini" | "runway" | "ltx" | "nvidia_api_catalog" | "mock";

export interface GenerateClipJobDeps {
  createGeneratedAsset: typeof realCreateGeneratedAsset;
  getActiveProjectScopedAsset: typeof realGetActiveProjectScopedAsset;
  selectGeneratedBeatClipAsset: typeof realSelectGeneratedBeatClipAsset;
  jobs: Pick<AgentApiStore, "setStep" | "succeed" | "fail">;
  resumeOrchestratorRun?: (
    runId: string,
    deps: { workspaceId: string }
  ) => Promise<unknown>;
}

const defaultDeps: GenerateClipJobDeps = {
  createGeneratedAsset: realCreateGeneratedAsset,
  getActiveProjectScopedAsset: realGetActiveProjectScopedAsset,
  selectGeneratedBeatClipAsset: realSelectGeneratedBeatClipAsset,
  jobs: agentApiStore,
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
  const fn =
    deps.resumeOrchestratorRun ??
    (await import("@/lib/orchestrator/engine")).resumeOrchestratorRun;
  await fn(runId, { workspaceId });
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
      provider: input.provider ?? "gemini",
      ...(input.model ? { model: input.model } : {}),
      beatId: input.beat.beatId,
      assetRole: "beat_clip",
      referenceAssetIds: [input.beat.keyframeAssetId],
      graphInputs: graphInputsForBeat(input.beat),
      ...(input.orchestratorRunId ? { runId: input.orchestratorRunId } : {}),
    },
  });

  const assetIds = assetIdsFromResult(result);
  for (const assetId of assetIds) {
    await input.deps.selectGeneratedBeatClipAsset({
      workspaceId: input.auth.workspaceId,
      projectId: input.projectId,
      assetId,
      beatId: input.beat.beatId,
    });
  }
  return assetIds;
}

export interface GenerateClipJobInput {
  jobId: string;
  workspaceId: string;
  projectId: string;
  orchestratorRunId?: string;
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
  try {
    await d.jobs.setStep(input.jobId, "generating_assets");
    const auth = localAuth(input.workspaceId);
    const generatedAssetIds: string[] = [];

    for (const beat of input.beats) {
      const assetIds = await generateClipForBeat({
        deps: d,
        auth,
        projectId: input.projectId,
        beat,
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.orchestratorRunId ? { orchestratorRunId: input.orchestratorRunId } : {}),
      });
      if (assetIds.length === 0) {
        throw new Error(`Clip generation returned no assets for ${beat.beatId}.`);
      }
      generatedAssetIds.push(...assetIds);
    }

    await d.jobs.succeed(input.jobId, {
      assetIds: generatedAssetIds,
      skippedBeatIds: input.skippedBeatIds ?? [],
    });
  } catch (err) {
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
