import type { RerunProposalV1 } from "@popcorn/shared/rerun-proposal";
import { ApiError } from "@/core/errors";
import { createAction, getStaleCandidates, listAssetSelectionRefs } from "@/lib/api/v1/store";
import { getOrchestratorRun } from "@/lib/api/v1/orchestrator-store";

const RERUN_PROPOSAL_TOOL = "rerun_proposal";

export interface RerunProposalServiceDeps {
  getStaleCandidates: typeof getStaleCandidates;
  listAssetSelectionRefs: typeof listAssetSelectionRefs;
  getOrchestratorRun: typeof getOrchestratorRun;
  createAction: typeof createAction;
}

const defaultDeps: RerunProposalServiceDeps = {
  getStaleCandidates,
  listAssetSelectionRefs,
  getOrchestratorRun,
  createAction,
};

export async function createRerunProposal(input: {
  workspaceId: string;
  projectId: string;
  assetId: string;
  message: string;
  rootRunId?: string;
}, deps: Partial<RerunProposalServiceDeps> = {}) {
  const resolved = { ...defaultDeps, ...deps };
  if (input.rootRunId) {
    const run = await resolved.getOrchestratorRun(input.rootRunId);
    if (run.projectId !== input.projectId || run.agentRole !== "creative_director") {
      throw new ApiError("validation_failed", "rootRunId must identify a root run for this project.");
    }
  }
  const graph = await resolved.getStaleCandidates(input.workspaceId, input.projectId, input.assetId);
  const targetSelections = await resolved.listAssetSelectionRefs(
    input.workspaceId, input.projectId, graph.changedAsset.assetId
  );
  const candidates = [graph.changedAsset, ...graph.candidates];
  const executable = graph.changedAsset.kind === "image";
  const selectedAssetIds = executable ? [graph.changedAsset.assetId] : [];
  const unavailableKinds = executable ? [] : [graph.changedAsset.kind];
  const proposal: RerunProposalV1 = {
    schemaVersion: "RerunProposal.v1",
    targetAssetId: graph.changedAsset.assetId,
    message: input.message,
    candidateAssetIds: candidates.map((candidate) => candidate.assetId),
    selectedAssetIds,
    unchangedAssetIds: graph.candidates.map((candidate) => candidate.assetId),
    pins: {
      assets: candidates.map((candidate) => ({ assetId: candidate.assetId, contentHash: candidate.contentHash })),
      selections: [
        ...targetSelections.map((selection) => ({
          slotOwnerLineageId: selection.slotOwnerLineageId,
          slotRole: selection.slotRole,
          activeAssetId: graph.changedAsset.assetId,
          seq: selection.seq,
        })),
        ...graph.candidates.flatMap((candidate) => candidate.selections.map((selection) => ({
        slotOwnerLineageId: selection.slotOwnerLineageId,
        slotRole: selection.slotRole,
        activeAssetId: candidate.assetId,
        seq: selection.seq,
        }))),
      ],
    },
    estimatedCostUsd: 0,
    requiresApproval: true,
    executable: false,
    hasImmutableRegenerationCoverage: executable,
    unavailableKinds,
    checklist: candidates.map((candidate) => ({
      assetId: candidate.assetId,
      decision: selectedAssetIds.includes(candidate.assetId) ? "regenerate" : "unchanged",
      reason: candidate.assetId === graph.changedAsset.assetId
        ? executable ? "The requested image can be regenerated immutably after approval." : "This asset kind has no enabled immutable regeneration path."
        : "Downstream work remains unchanged until its kind-specific regeneration path is enabled.",
    })),
  };
  const action = await resolved.createAction({
    projectId: input.projectId,
    ...(input.rootRunId ? { orchestratorRunId: input.rootRunId } : {}),
    tool: RERUN_PROPOSAL_TOOL,
    status: "proposed",
    inputAssetIds: candidates.map((candidate) => candidate.assetId),
    rationale: input.message,
    params: { schemaVersion: "rerun_proposal_request.v1", assetId: input.assetId, message: input.message },
    proposal: proposal as unknown as Record<string, unknown>,
  });
  return { actionId: action.id, proposal };
}
