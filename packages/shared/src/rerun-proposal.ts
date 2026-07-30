import type { DomainTarget } from "./domain-agent-contract";

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

export type RerunTarget =
  | DomainTarget
  | {
      kind: "selection";
      projectId: string;
      slotOwnerLineageId: string | null;
      slotRole: string;
    }
  | {
      kind: "transcript_segment";
      projectId: string;
      transcriptSegmentId: string;
    };

export interface AssetFingerprintPin {
  assetId: string;
  contentHash: string | null;
  inputsFingerprint: string | null;
}

export interface SelectionSequencePin {
  slotOwnerLineageId: string | null;
  slotRole: string;
  expectedActiveAssetId: string | null;
  expectedSeq: number;
}

export interface StorySnapshotPin {
  /** Canonical live relational pointer; story_panels have no semantic snapshot pointer. */
  rowKind: "story_blueprint" | "storyboard" | "story_scene" | "story_beat";
  rowId: string;
  expectedSnapshotAssetId: string | null;
}

export interface RerunChecklistItem {
  target: RerunTarget;
  decision: "change" | "preserve" | "clarify";
  reason: string;
}

export interface BoundRequiredOutput {
  /**
   * Server-issued identity carried unchanged through DomainRequiredOutput and
   * DomainReport output entries in PR 2. Never infer this from kind/role.
   */
  bindingId: string;
  workItemId: string;
  target: RerunTarget;
  kind: string;
  role: string;
  ordinal: number;
}

export type RerunWorkItem =
  | {
      workItemId: string;
      owner: "creative_director";
      kind: "revise_story" | "reassemble_cut" | "critique_cut";
      targets: RerunTarget[];
      requiredOutputs: BoundRequiredOutput[];
    }
  | {
      workItemId: string;
      owner: "visuals";
      kind: "revise_visuals";
      targets: RerunTarget[];
      requiredOutputs: BoundRequiredOutput[];
    }
  | {
      workItemId: string;
      owner: "audio";
      kind: "revise_audio";
      targets: RerunTarget[];
      requiredOutputs: BoundRequiredOutput[];
    };

export interface PlannedSelectionMove {
  bindingId: string;
  slotOwnerLineageId: string | null;
  slotRole: string;
  expectedActiveAssetId: string | null;
  expectedSeq: number;
}

export interface PlannedStoryPointerMove {
  bindingId: string;
  rowKind: "story_blueprint" | "storyboard" | "story_scene" | "story_beat";
  rowId: string;
  expectedSnapshotAssetId: string | null;
}

export interface RerunProposalBaseV2 {
  schemaVersion: "RerunProposal.v2";
  projectId: string;
  /** Active hierarchy run anchoring this preview, or null until execution creates one. */
  rootRunId: string | null;
  source: "request_changes" | "autonomous_review";
  userIntent: string;
  targets: RerunTarget[];
  inspectedAssetIds: string[];
  candidateAffectedAssetIds: string[];
  preservedAssetIds: string[];
  checklist: RerunChecklistItem[];
  pins: {
    assets: AssetFingerprintPin[];
    selections: SelectionSequencePin[];
    storySnapshots: StorySnapshotPin[];
  };
  estimate: {
    costUsd: number;
    maxCostUsd: number;
    latencyClass: "interactive" | "media";
  };
  risk: "low" | "medium" | "high";
  requiresApproval: boolean;
  rationale: string;
  userFacingSummary: string;
}

export type RerunProposalV2 =
  | (RerunProposalBaseV2 & {
      outcome: "no_op";
      selectedWork: [];
      plannedSelectionMoves: [];
      plannedStoryPointerMoves: [];
      requiresApproval: false;
      clarification?: never;
    })
  | (RerunProposalBaseV2 & {
      outcome: "ask_clarification";
      selectedWork: [];
      plannedSelectionMoves: [];
      plannedStoryPointerMoves: [];
      requiresApproval: false;
      clarification: {
        question: string;
        targets: RerunTarget[];
        options: Array<{ id: string; label: string; tradeoff: string }>;
        answerFingerprint: string;
      };
    })
  | (RerunProposalBaseV2 & {
      outcome: "revision";
      selectedWork: [RerunWorkItem, ...RerunWorkItem[]];
      plannedSelectionMoves: PlannedSelectionMove[];
      plannedStoryPointerMoves: PlannedStoryPointerMove[];
      requiresApproval: boolean;
      clarification?: never;
    });

export interface CreateRerunProposalV2Request {
  message: string;
  targets: RerunTarget[];
  rootRunId?: string;
}
