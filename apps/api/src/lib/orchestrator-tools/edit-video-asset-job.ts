import { agentApiStore, type AgentApiStore } from "@/lib/agent-api/jobs";
import type { AuthContext } from "@/lib/api/v1/auth";
import { createGeneratedAsset as realCreateGeneratedAsset } from "@/lib/api/v1/generated-assets";
import {
  selectGeneratedBeatClipAsset as realSelectGeneratedBeatClipAsset,
} from "@/lib/api/v1/store";
import type { GraphAssetInput } from "@/lib/api/v1/asset-graph";

type EditVideoProvider = "gemini" | "mock";

export interface EditVideoAssetJobDeps {
  createGeneratedAsset: typeof realCreateGeneratedAsset;
  selectGeneratedBeatClipAsset: typeof realSelectGeneratedBeatClipAsset;
  jobs: Pick<AgentApiStore, "setStep" | "succeed" | "fail">;
  resumeOrchestratorRun?: (
    runId: string,
    deps: { workspaceId: string }
  ) => Promise<unknown>;
}

const defaultDeps: EditVideoAssetJobDeps = {
  createGeneratedAsset: realCreateGeneratedAsset,
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
  deps: EditVideoAssetJobDeps,
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

function graphInputsForEdit(input: EditVideoAssetJobInput): GraphAssetInput[] {
  return [
    {
      assetId: input.sourceAssetId,
      relation: "input",
      role: "edited_from",
      position: 0,
      ...(input.sourceContentHash ? { contentHash: input.sourceContentHash } : {}),
    },
  ];
}

export interface EditVideoAssetJobInput {
  jobId: string;
  workspaceId: string;
  projectId: string;
  sourceAssetId: string;
  instruction: string;
  sourceContentHash?: string;
  sourceDurationSec?: number;
  sourceRole?: string;
  beatId?: string;
  provider: EditVideoProvider;
  model: string;
  orchestratorRunId?: string;
}

export async function runEditVideoAssetJob(
  input: EditVideoAssetJobInput,
  deps: Partial<EditVideoAssetJobDeps> = {}
): Promise<void> {
  const d = { ...defaultDeps, ...deps };
  try {
    await d.jobs.setStep(input.jobId, "generating_assets");
    const auth = localAuth(input.workspaceId);
    const role = input.beatId ? "beat_clip" : input.sourceRole;

    const result = await d.createGeneratedAsset({
      auth,
      projectId: input.projectId,
      body: {
        kind: "video",
        provider: input.provider,
        model: input.model,
        prompt: input.instruction,
        description: input.instruction,
        durationSec: input.sourceDurationSec ?? 8,
        seconds: input.sourceDurationSec ?? 8,
        editSourceAssetId: input.sourceAssetId,
        referenceAssetIds: [input.sourceAssetId],
        graphInputs: graphInputsForEdit(input),
        ...(role ? { assetRole: role } : {}),
        ...(input.beatId ? { beatId: input.beatId } : {}),
        ...(input.orchestratorRunId ? { runId: input.orchestratorRunId } : {}),
      },
    });

    const assetIds = assetIdsFromResult(result);
    if (assetIds.length === 0) {
      throw new Error("Video edit returned no generated asset ids.");
    }

    if (input.beatId) {
      for (const assetId of assetIds) {
        await d.selectGeneratedBeatClipAsset({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          beatId: input.beatId,
          assetId,
        });
      }
    }

    await d.jobs.succeed(input.jobId, { assetIds, sourceAssetId: input.sourceAssetId });
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
