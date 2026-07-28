/**
 * Durable, server-derived contract for a graph-scoped Request Changes preview.
 * A proposal is intent plus freshness pins; it is never permission to mutate a
 * selection or invoke a provider by itself.
 */
export interface RerunProposalV1 {
  schemaVersion: "RerunProposal.v1";
  targetAssetId: string;
  message: string;
  candidateAssetIds: string[];
  selectedAssetIds: string[];
  unchangedAssetIds: string[];
  pins: {
    assets: Array<{ assetId: string; contentHash: string | null }>;
    selections: Array<{
      slotOwnerLineageId: string | null;
      slotRole: string;
      activeAssetId: string;
      seq: number;
    }>;
  };
  estimatedCostUsd: number;
  requiresApproval: boolean;
  /** Always false until proposal execution can revalidate these pins. */
  executable: false;
  hasImmutableRegenerationCoverage: boolean;
  unavailableKinds: string[];
  checklist: Array<{ assetId: string; decision: "regenerate" | "unchanged"; reason: string }>;
}

export interface CreateRerunProposalRequest {
  assetId: string;
  message: string;
  /** An optional current root run; the server verifies project ownership. */
  rootRunId?: string;
}
