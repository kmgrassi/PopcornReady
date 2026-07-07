import { agentApiStore, type AgentApiStore } from "@/lib/agent-api/jobs";
import type { AuthContext } from "@/lib/api/v1/auth";
import { createGeneratedAsset as realCreateGeneratedAsset } from "@/lib/api/v1/generated-assets";
import { getAsset as realGetAsset, type V1Asset } from "@/lib/api/v1/store";
import { getServiceSupabase } from "@/lib/supabase/clients";

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

export interface EditVideoAssetJobDeps {
  createGeneratedAsset: typeof realCreateGeneratedAsset;
  getAsset: typeof realGetAsset;
  jobs: Pick<AgentApiStore, "setStep" | "succeed" | "fail">;
  resumeOrchestratorRun?: (
    runId: string,
    deps: { workspaceId: string }
  ) => Promise<unknown>;
}

const defaultDeps: EditVideoAssetJobDeps = {
  createGeneratedAsset: realCreateGeneratedAsset,
  getAsset: realGetAsset,
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

async function swapSelections(input: {
  projectId: string;
  sourceAssetId: string;
  editedAssetId: string;
}): Promise<string[]> {
  const db = getServiceSupabase();
  const { data, error } = await db
    .from("current_selections")
    .select("slot_role")
    .eq("project_id", input.projectId)
    .eq("active_asset_id", input.sourceAssetId);
  if (error) throw error;
  const slots = (data ?? [])
    .map((row) => row.slot_role)
    .filter((slot): slot is string => typeof slot === "string" && slot.length > 0);
  if (slots.length === 0) return [];

  const { error: insertError } = await db.from("selections").insert(
    slots.map((slotRole) => ({
      project_id: input.projectId,
      slot_owner_lineage_id: null,
      slot_role: slotRole,
      active_asset_id: input.editedAssetId,
    }))
  );
  if (insertError) throw insertError;
  return slots;
}

function editedAssetRole(source: V1Asset): string | undefined {
  return source.role || undefined;
}

export interface EditVideoAssetJobInput {
  jobId: string;
  workspaceId: string;
  projectId: string;
  sourceAssetId: string;
  sourceContentHash?: string;
  instruction: string;
  beatId?: string;
  provider?: VideoProvider;
  model?: string;
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
    const source = await d.getAsset(input.workspaceId, input.projectId, input.sourceAssetId);
    const result = await d.createGeneratedAsset({
      auth,
      projectId: input.projectId,
      body: {
        kind: "video",
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.model ? { model: input.model } : {}),
        prompt: input.instruction,
        description: input.instruction,
        durationSec: source.durationSec ?? 8,
        seconds: source.durationSec ?? 8,
        editSourceAssetId: input.sourceAssetId,
        assetRole: editedAssetRole(source),
        ...(input.beatId ? { beatId: input.beatId } : {}),
        name: `Edited ${source.name || source.filename || "video"}`,
        graphInputs: [
          {
            assetId: input.sourceAssetId,
            relation: "input",
            role: "edited_from",
            position: 0,
            ...(input.sourceContentHash ? { contentHash: input.sourceContentHash } : {}),
          },
        ],
        ...(input.orchestratorRunId ? { runId: input.orchestratorRunId } : {}),
      },
    });

    const assetIds = assetIdsFromResult(result);
    if (assetIds.length === 0) {
      throw new Error(`Video edit returned no assets for ${input.sourceAssetId}.`);
    }
    const selectionSlots: string[] = [];
    for (const assetId of assetIds) {
      selectionSlots.push(
        ...(await swapSelections({
          projectId: input.projectId,
          sourceAssetId: input.sourceAssetId,
          editedAssetId: assetId,
        }))
      );
    }
    await d.jobs.succeed(input.jobId, {
      assetIds,
      sourceAssetId: input.sourceAssetId,
      selectionSlots: [...new Set(selectionSlots)],
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
        // Durable run sweepers can resume a parked run later.
      }
    }
  }
}
