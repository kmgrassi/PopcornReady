/**
 * Shared control-plane contract for persistent Visuals and Audio sessions.
 * Creative state remains in the immutable asset graph; these types carry only
 * bounded intent, stable references, and terminal turn-boundary outcomes.
 */

declare const stableIdBrand: unique symbol;

type StableId<StorageIdentity extends string> = string & {
  readonly [stableIdBrand]: StorageIdentity;
};

/** Canonical `agent_sessions.id`; one persists for each project/domain pair. */
export type AgentSessionId = StableId<"agent_sessions.id">;

/** Canonical `orchestrator_runs.id`; the run is the finite assignment. */
export type OrchestratorRunId = StableId<"orchestrator_runs.id">;

/** Canonical `actions.id`; this is not a domain-specific report identity. */
export type ActionId = StableId<"actions.id">;

/** The existing `actions.id` whose tool is `domain_report`. */
export type DomainReportActionId = ActionId;

export type AgentRole = "creative_director" | "visuals" | "audio";
export type AgentDomain = Exclude<AgentRole, "creative_director">;

export type CreatorDirectTaskKind =
  | "image_create"
  | "video_create"
  | "video_edit"
  | "soundtrack_create"
  | "audio_create";

export type VisualsProductionTaskKind =
  | "visuals_production"
  | "visuals_revision";

export type AudioProductionTaskKind =
  | "audio_production"
  | "audio_fit"
  | "audio_revision";

export type VisualsTaskKind =
  | Extract<CreatorDirectTaskKind, "image_create" | "video_create" | "video_edit">
  | VisualsProductionTaskKind;

export type CreatorDirectVisualTaskKind = Extract<
  CreatorDirectTaskKind,
  "image_create" | "video_create" | "video_edit"
>;

export type AudioTaskKind =
  | Extract<CreatorDirectTaskKind, "soundtrack_create" | "audio_create">
  | AudioProductionTaskKind;

/**
 * Transport state for a confirmed finite assignment. A creator-direct proposal
 * is gated separately and does not become queued until it is confirmed.
 */
export type DomainRunState =
  | "queued"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "canceled"
  | "timed_out"
  | "superseded";

export type DomainRunWaitReason = "media_job" | "domain" | "approval";

/** Creator-direct quote state is orthogonal to finite-run transport state. */
export type CreatorDirectProposalState =
  | "proposed"
  | "confirmed"
  | "rejected"
  | "expired";

/** The only identifiers exposed by creator-facing domain-run APIs. */
export interface DomainRunPublicIdentity {
  sessionId: AgentSessionId;
  runId: OrchestratorRunId;
}

/** Internal envelope for the task params stored on the canonical finite run. */
export interface DomainTaskEnvelopeV1 extends DomainRunPublicIdentity {
  task: DomainTaskV1;
}

/** Internal envelope for the report params stored on the canonical action. */
export interface DomainReportEnvelopeV1 extends DomainRunPublicIdentity {
  reportActionId: DomainReportActionId;
  report: DomainReportV1;
}

export type DomainTarget =
  | { kind: "project"; projectId: string }
  | { kind: "storyboard"; projectId: string; storyboardId: string }
  | { kind: "scene"; projectId: string; sceneId: string }
  | { kind: "beat"; projectId: string; beatId: string }
  | { kind: "panel"; projectId: string; panelId: string }
  | { kind: "asset"; projectId: string; assetId: string }
  | { kind: "lineage"; projectId: string; lineageId: string }
  | { kind: "timeline_item"; projectId: string; timelineItemId: string }
  | { kind: "export"; projectId: string; exportId: string }
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

/** Semantic alias retained for task/report readability. */
export type DomainTaskTarget = DomainTarget;
export type VisualsOutputKind =
  | "image"
  | "poster"
  | "anchor"
  | "storyboard"
  | "keyframe"
  | "clip"
  | "composite"
  | "render";

type CreatorDirectVisualOutputKinds<
  TaskKind extends CreatorDirectVisualTaskKind,
> = TaskKind extends "image_create"
  ? Extract<VisualsOutputKind, "image">
  : TaskKind extends "video_create"
    ? Extract<VisualsOutputKind, "clip" | "composite" | "render">
    : Extract<VisualsOutputKind, "clip">;

/**
 * `audio_fit` is a bound critique/fit result, not an audio track. Keeping it
 * distinct prevents a fit report from satisfying a requested media output.
 */
export type AudioOutputKind = "audio_track" | "audio_fit";
export type DomainOutputKind = VisualsOutputKind | AudioOutputKind;

interface DomainRequiredOutputBase<OutputKind extends DomainOutputKind> {
  kind: OutputKind;
  role: string;
  minimumCount: number;
}

export type DomainRequiredOutput<OutputKind extends DomainOutputKind> =
  | (DomainRequiredOutputBase<OutputKind> & {
  /** Server-issued proposal-local identity; never reconstructed from role/kind. */
  bindingId: string;
  workItemId: string;
  target: DomainTaskTarget;
  ordinal: number;
  })
  | (DomainRequiredOutputBase<OutputKind> & {
      /** Non-proposal creator/direct and historical assignments stay readable. */
      bindingId?: never;
      workItemId?: never;
      target?: never;
      ordinal?: never;
    });

export interface DomainCreativeConstraints {
  tone?: string;
  mood?: string;
  pacing?: string;
  continuity?: readonly string[];
  notes?: readonly string[];
}

export interface DomainPreserveSet {
  assetIds: readonly string[];
  selections: readonly {
    slotRole: string;
    slotKey: string;
    activeAssetId: string;
    sequence?: number;
  }[];
  fingerprints: readonly {
    assetId: string;
    value: string;
  }[];
  pins: readonly {
    kind: "asset" | "selection" | "target";
    id: string;
    fingerprint?: string;
  }[];
}

export interface DomainApprovalContext {
  proposalActionId: ActionId;
  /** Durable action that recorded the creator approval. */
  approvalActionId?: ActionId;
  /** Fenced proposal execution reservation, when this is rerun work. */
  executionReservationId?: string;
  approvedBudgetUsd: number;
  approvalFingerprint: string;
}

export interface CreativeDirectorTaskRoute {
  origin: {
    kind: "creative_director";
    rootRunId: OrchestratorRunId;
    rootActionId: ActionId;
    creatorMessageId: string;
  };
  responseRecipient: {
    kind: "creative_director";
  };
}

export interface CreatorDirectTaskRoute {
  origin: {
    kind: "creator_direct";
    actorId: string;
    creatorMessageId: string;
    entrypoint: "asset_studio" | "project_api" | "global_create";
    requestDigest: string;
    idempotencyKey: string;
    approvalGateId: string;
  };
  responseRecipient: {
    kind: "creator_conversation";
  };
  approvalContext: DomainApprovalContext;
}

interface DomainTaskBase<
  Domain extends AgentDomain,
  TaskKind extends string,
  OutputKind extends DomainOutputKind,
> {
  schemaVersion: "DomainTask.v1";
  domain: Domain;
  taskKind: TaskKind;
  objective: string;
  instruction: string;
  targets: readonly DomainTaskTarget[];
  requiredOutputs: readonly DomainRequiredOutput<OutputKind>[];
  allowedOutputKinds: readonly OutputKind[];
  creativeConstraints: DomainCreativeConstraints;
  preserve: DomainPreserveSet;
  candidateAffectedAssetIds: readonly string[];
  budgetUsd: number;
  approvalContext?: DomainApprovalContext;
  acceptanceCriteria: readonly string[];
}

/**
 * A finite, schema-marked assignment stored on `orchestrator_runs`. The union
 * makes domain/task-kind and trusted-origin/recipient mismatches unrepresentable.
 */
export type DomainTaskV1 =
  | (DomainTaskBase<"visuals", VisualsProductionTaskKind, VisualsOutputKind> &
      CreativeDirectorTaskRoute)
  | (DomainTaskBase<"audio", AudioProductionTaskKind, AudioOutputKind> &
      CreativeDirectorTaskRoute)
  | (DomainTaskBase<
        "visuals",
        "image_create",
        CreatorDirectVisualOutputKinds<"image_create">
      > &
      CreatorDirectTaskRoute)
  | (DomainTaskBase<
        "visuals",
        "video_create",
        CreatorDirectVisualOutputKinds<"video_create">
      > &
      CreatorDirectTaskRoute)
  | (DomainTaskBase<
        "visuals",
        "video_edit",
        CreatorDirectVisualOutputKinds<"video_edit">
      > &
      CreatorDirectTaskRoute)
  | (DomainTaskBase<
        "audio",
        Extract<CreatorDirectTaskKind, "soundtrack_create" | "audio_create">,
        AudioOutputKind
      > &
      CreatorDirectTaskRoute);

export interface DomainAcceptanceEvidence {
  criterion: string;
  satisfied: boolean;
  evidence: string;
  assetIds?: readonly string[];
}

export interface DomainDoneOutcome {
  outcome: "done";
  outputs: readonly ({
    bindingId: string;
    workItemId: string;
    target: DomainTaskTarget;
    kind: DomainOutputKind;
    role: string;
    ordinal: number;
    assetId: string;
    intrinsicRole: string;
  } | {
    /** Historical/unbound report entry. */
    assetId: string;
    intrinsicRole: string;
    bindingId?: never;
    workItemId?: never;
    target?: never;
    kind?: never;
    role?: never;
    ordinal?: never;
  })[];
  changedSelections: readonly {
    slotRole: string;
    slotKey: string;
    activeAssetId: string;
  }[];
  acceptanceEvidence: readonly DomainAcceptanceEvidence[];
  sessionSummary: string;
}

/** A domain-safe projection of a tool-level PreconditionMiss. */
export interface DomainBlockedOutcome {
  outcome: "blocked";
  precondition: {
    requirement: string;
    because: string;
  };
  requiredDomain: AgentDomain | "creative_director";
  targets: readonly DomainTarget[];
  reason: string;
}

export interface DomainQuestionOutcome {
  outcome: "question";
  question: string;
  targets: readonly DomainTarget[];
  options: readonly {
    id: string;
    label: string;
    tradeoff: string;
  }[];
  fingerprint: string;
}

export type DomainReportOutcome =
  | DomainDoneOutcome
  | DomainBlockedOutcome
  | DomainQuestionOutcome;

/**
 * The unique terminal `domain_report` action payload for one finite run.
 * Runtime failures/cancellation never masquerade as agent-authored outcomes.
 */
export interface DomainReportV1 {
  schemaVersion: "DomainReport.v1";
  outcome: DomainReportOutcome;
}
