import type { AssetSemanticAnalysis } from "../../assets/semantic-analysis";
import type {
  AgentAssetContext,
  AgentAssetSource,
  AgentClipContext,
  AssetContext,
  AssetKind,
  AssetKnowledge,
  SCHEMA_VERSIONS,
  UserAssetContext,
  VideoBrief,
} from "./schemas";
import type { GeneratedAssetProvenance } from "./provenance";
import type { GraphAssetInput } from "./asset-graph";
import type { ScriptDraft } from "@popcorn/shared/types";

export interface V1Workspace {
  id: string;
  schemaVersion: typeof SCHEMA_VERSIONS.workspace;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export type WorkspaceRole = "owner" | "admin" | "member";

export interface V1Project {
  id: string;
  schemaVersion: typeof SCHEMA_VERSIONS.project;
  workspaceId: string;
  name: string;
  // Stable, workspace-scoped, lowercase handle written by the generating agent.
  slug?: string | null;
  status: "active" | "deleted";
  visibility?: "public" | "private";
  brief: VideoBrief | null;
  currentBriefVersionId: string | null;
  hasStoryboard?: boolean;
  posterAssetId: string | null;
  posterUrl: string | null;
  scriptAssetId?: string | null;
  activeScript?: ScriptDraft | null;
  createdAt: string;
  updatedAt: string;
}

export interface V1BriefVersion {
  id: string;
  schemaVersion: typeof SCHEMA_VERSIONS.briefVersion;
  projectId: string;
  brief: VideoBrief;
  createdAt: string;
}

export interface V1Asset {
  id: string;
  schemaVersion: typeof SCHEMA_VERSIONS.asset;
  workspaceId: string;
  projectId: string;
  kind: AssetKind;
  role?: string;
  // Human display name written by the generating agent (falls back to a derived name).
  name?: string;
  // Stable, project-scoped, lowercase handle written by the generating agent. Agents
  // may reference this asset by (project, slug); resolved in getAssetRow.
  slug?: string | null;
  description?: string;
  filename: string;
  status: "ready" | "pending";
  source: AgentAssetSource;
  visibility?: "public" | "private";
  remoteUrl?: string;
  thumbnailUrl?: string;
  expiresAt?: string | null;
  storageKey?: string;
  storageBucket?: string;
  durationSec?: number;
  context?: AssetContext;
  userContext?: UserAssetContext;
  agentContext?: AgentAssetContext | AgentClipContext;
  assetKnowledge?: AssetKnowledge;
  clipUnderstanding?: {
    assetId: string;
    source: "upload" | "generated";
    combinedSummary: string;
    timelineHints: {
      mustUse: boolean;
      avoid: boolean;
      preferredBeats: string[];
      bestStartSec?: number;
      bestEndSec?: number;
    };
    provenance: {
      userContextUpdatedAt?: string;
      analyzedAt?: string;
      analysisVersion: string;
      sampledFrameAssetIds: string[];
    };
  };
  semanticAnalysis?: AssetSemanticAnalysis;
  analysis?: V1AssetAnalysis;
  // Present for assets produced by the generated-assets endpoint (PR2).
  provenance?: GeneratedAssetProvenance;
  graphInputs?: GraphAssetInput[];
  contentHash?: string;
  inputsFingerprint?: string;
  createdAt: string;
  updatedAt: string;
}

export interface V1AssetAnalysis {
  schemaVersion: "assetAnalysis.v1";
  status: "succeeded" | "failed";
  analyzedAt: string;
  analysisVersion: string;
  sampledFrames: string[];
  observations?: {
    summary: string;
    subjects: string[];
    actions: string[];
    setting?: string;
    mood?: string;
    likelyUses: string[];
    cautions: string[];
    confidence: "low" | "medium" | "high";
    model: {
      provider: string;
      model?: string;
    };
  };
  error?: {
    code: string;
    message: string;
  };
}

export interface IdempotencyRecord {
  scope: string;
  key: string;
  bodyHash: string;
  status: number;
  responseBody: unknown;
  createdAt: string;
}

export type IdempotencyReservationState = "reserved" | "pending" | "replay" | "conflict";

export interface IdempotencyReservation {
  state: IdempotencyReservationState;
  status?: number;
  responseBody?: unknown;
  leaseToken?: string;
}

export type ProviderJobClaimState = "claimed" | "held" | "terminal";

export interface ProviderJobClaim {
  state: ProviderJobClaimState;
  claimToken?: string;
}

export interface AssetGraphSelectionRef {
  slotOwnerLineageId: string | null;
  slotRole: string;
  seq: number;
}

export interface StaleCandidateAsset {
  assetId: string;
  depth: number;
  ref: string | null;
  kind: string;
  status: string;
  role: string | null;
  lineageId: string;
  version: number;
  contentHash: string | null;
  inputsFingerprint: string | null;
  selections: AssetGraphSelectionRef[];
}

export interface StaleCandidatesResult {
  changedAsset: {
    assetId: string;
    ref: string | null;
    kind: string;
    contentHash: string | null;
  };
  candidates: StaleCandidateAsset[];
}

export type ActionStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "running"
  | "applied"
  | "failed";

export interface V1Action {
  id: string;
  schemaVersion: "action.v1";
  projectId: string;
  orchestratorRunId?: string;
  tool: string;
  status: ActionStatus;
  params: Record<string, unknown>;
  inputAssetIds: string[];
  rationale?: string;
  proposal?: Record<string, unknown>;
  jobIds: string[];
  outputAssetIds: string[];
  error?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateActionInput {
  /**
   * Optional caller-reserved identity. Orchestrator invocations allocate this
   * before external work so a retried persistence write cannot append a second
   * action for the same tool call.
   */
  id?: string;
  projectId: string;
  orchestratorRunId?: string;
  tool: string;
  status?: ActionStatus;
  params?: Record<string, unknown>;
  inputAssetIds?: string[];
  rationale?: string;
  proposal?: Record<string, unknown>;
  jobIds?: string[];
  outputAssetIds?: string[];
  error?: Record<string, unknown>;
}

export type VisualAnchorPlanItemKind = "character" | "location" | "style";

export interface VisualAnchorPlanItem {
  id: string;
  kind: VisualAnchorPlanItemKind;
  label: string;
  description: string;
  sourceSceneIds: string[];
  sourceBeatIds: string[];
}

export interface VisualAnchorPlan {
  schemaVersion: "visual_anchor_plan.v1";
  anchors: VisualAnchorPlanItem[];
}

export interface StoryBlueprintCharacter {
  id: string;
  name: string;
  role: string;
  description: string;
}

export interface StoryBlueprintAct {
  id: string;
  title: string;
  purpose: string;
  summary: string;
  targetDurationSec: number;
}

export interface StoryBlueprintScene {
  id: string;
  title: string;
  summary: string;
  actId: string;
  targetDurationSec: number;
}

export interface StoryBlueprint {
  schemaVersion: "storyBlueprint.v1";
  premise: string;
  logline: string;
  tone: string;
  audience?: string;
  targetLengthSec: number;
  aspectRatio: VideoBrief["aspectRatio"];
  characters: StoryBlueprintCharacter[];
  acts: StoryBlueprintAct[];
  scenes: StoryBlueprintScene[];
  ending: string;
}

export interface StoryBlueprintRecord {
  id: string;
  schemaVersion: "storyBlueprint.v1";
  workspaceId: string;
  projectId: string;
  briefAssetId: string | null;
  assetId: string | null;
  status: "draft" | "approved" | "superseded";
  content: StoryBlueprint;
  createdAt: string;
  updatedAt: string;
}

export type UpdateActionPatch = Partial<
  Pick<V1Action, "status" | "jobIds" | "outputAssetIds" | "error">
>;
