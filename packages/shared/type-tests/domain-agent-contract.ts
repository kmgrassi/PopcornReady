import type {
  ActionId,
  AgentSessionId,
  CreatorDirectTaskKind,
  DomainReportActionId,
  DomainReportEnvelopeV1,
  DomainReportOutcome,
  DomainRunPublicIdentity,
  DomainRunState,
  DomainTaskEnvelopeV1,
  DomainTaskV1,
  OrchestratorRunId,
} from "@popcorn/shared/domain-agent-contract";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? true
    : false;
type Assert<Condition extends true> = Condition;

type VisualsDirectTask = Extract<
  DomainTaskV1,
  { domain: "visuals"; origin: { kind: "creator_direct" } }
>;
type AudioDirectTask = Extract<
  DomainTaskV1,
  { domain: "audio"; origin: { kind: "creator_direct" } }
>;
type RootTask = Extract<
  DomainTaskV1,
  { origin: { kind: "creative_director" } }
>;

type _VisualsDirectKindsAreBounded = Assert<
  Equal<VisualsDirectTask["taskKind"], "image_create" | "video_create" | "video_edit">
>;
type _AudioDirectKindsAreBounded = Assert<
  Equal<AudioDirectTask["taskKind"], "soundtrack_create" | "audio_create">
>;
type _AllDirectKindsAreCovered = Assert<
  Equal<
    CreatorDirectTaskKind,
    VisualsDirectTask["taskKind"] | AudioDirectTask["taskKind"]
  >
>;
type _RootRecipientCannotBeCreatorConversation = Assert<
  Equal<RootTask["responseRecipient"]["kind"], "creative_director">
>;
type _DirectRecipientCannotBeRoot = Assert<
  Equal<VisualsDirectTask["responseRecipient"]["kind"], "creator_conversation">
>;
type _CreatorDirectApprovalContextIsRequired = Assert<
  Equal<undefined extends VisualsDirectTask["approvalContext"] ? true : false, false>
>;
type _VisualsCannotAuthorizeAudioOutputs = Assert<
  Equal<"audio_track" extends VisualsDirectTask["allowedOutputKinds"][number] ? true : false, false>
>;
type _AudioCannotAuthorizeVisualOutputs = Assert<
  Equal<"clip" extends AudioDirectTask["allowedOutputKinds"][number] ? true : false, false>
>;
type _ReportsHaveOnlyTurnBoundaryOutcomes = Assert<
  Equal<DomainReportOutcome["outcome"], "done" | "blocked" | "question">
>;
type _RuntimeStateIsSeparateFromReportOutcome = Assert<
  Equal<
    DomainRunState,
    | "queued"
    | "running"
    | "waiting"
    | "succeeded"
    | "failed"
    | "canceled"
    | "timed_out"
    | "superseded"
  >
>;
type _PublicIdentityHasNoReportIdentifier = Assert<
  Equal<keyof DomainRunPublicIdentity, "sessionId" | "runId">
>;
type _SessionAndRunIdsCannotBeMixed = Assert<
  Equal<OrchestratorRunId extends AgentSessionId ? true : false, false>
>;
type _ReportIdIsAnExistingActionId = Assert<
  Equal<DomainReportActionId, ActionId>
>;
type _PersistedTaskDoesNotRepeatEnvelopeIdentity = Assert<
  Equal<Extract<keyof DomainTaskV1, "sessionId" | "runId">, never>
>;
type _PersistedReportDoesNotRepeatEnvelopeIdentity = Assert<
  Equal<Extract<keyof import("@popcorn/shared/domain-agent-contract").DomainReportV1, "sessionId" | "runId" | "reportActionId">, never>
>;

const sessionId = "session-1" as AgentSessionId;
const runId = "run-1" as OrchestratorRunId;
const actionId = "action-1" as ActionId;

export const creatorDirectVisualsFixture = {
  schemaVersion: "DomainTask.v1",
  domain: "visuals",
  taskKind: "video_edit",
  origin: {
    kind: "creator_direct",
    actorId: "actor-1",
    creatorMessageId: "message-1",
    entrypoint: "asset_studio",
    requestDigest: "sha256:request",
    idempotencyKey: "idem-1",
    approvalGateId: "gate-1",
  },
  responseRecipient: {
    kind: "creator_conversation",
  },
  objective: "Remove a logo from an uploaded clip.",
  instruction: "Edit only the pinned source clip and preserve its timing.",
  targets: [{ kind: "asset", projectId: "project-1", assetId: "asset-1" }],
  requiredOutputs: [{ kind: "clip", role: "edited_source", minimumCount: 1 }],
  allowedOutputKinds: ["clip"],
  creativeConstraints: { continuity: ["Preserve subject identity"] },
  preserve: {
    assetIds: ["asset-1"],
    selections: [],
    fingerprints: [{ assetId: "asset-1", value: "sha256:asset" }],
    pins: [{ kind: "asset", id: "asset-1", fingerprint: "sha256:asset" }],
  },
  candidateAffectedAssetIds: [],
  budgetUsd: 3,
  approvalContext: {
    proposalActionId: actionId,
    approvedBudgetUsd: 3,
    approvalFingerprint: "sha256:approval",
  },
  acceptanceCriteria: ["The logo is not visible in the edited clip."],
} satisfies DomainTaskV1;

export const rootAudioFixture = {
  schemaVersion: "DomainTask.v1",
  domain: "audio",
  taskKind: "audio_fit",
  origin: {
    kind: "creative_director",
    rootRunId: "root-run-1" as OrchestratorRunId,
    rootActionId: actionId,
    creatorMessageId: "message-2",
  },
  responseRecipient: {
    kind: "creative_director",
  },
  objective: "Fit the approved narration to picture.",
  instruction: "Preserve spoken meaning while matching the current cut.",
  targets: [{ kind: "timeline_item", projectId: "project-1", timelineItemId: "cut-1" }],
  requiredOutputs: [{ kind: "audio_track", role: "voiceover", minimumCount: 1 }],
  allowedOutputKinds: ["audio_track"],
  creativeConstraints: { pacing: "Match the approved cut." },
  preserve: { assetIds: [], selections: [], fingerprints: [], pins: [] },
  candidateAffectedAssetIds: [],
  budgetUsd: 2,
  acceptanceCriteria: ["Narration fits without changing its meaning."],
} satisfies DomainTaskV1;

export const doneReportFixture = {
  schemaVersion: "DomainReport.v1",
  outcome: {
    outcome: "done",
    outputs: [{ assetId: "audio-1", intrinsicRole: "voiceover" }],
    changedSelections: [],
    acceptanceEvidence: [
      {
        criterion: "Narration fits without changing its meaning.",
        satisfied: true,
        evidence: "Measured duration fits the pinned cut.",
        assetIds: ["audio-1"],
      },
    ],
    sessionSummary: "Fitted the approved narration to the current cut.",
  },
} satisfies import("@popcorn/shared/domain-agent-contract").DomainReportV1;

export const taskEnvelopeFixture = {
  sessionId,
  runId,
  task: creatorDirectVisualsFixture,
} satisfies DomainTaskEnvelopeV1;

export const reportEnvelopeFixture = {
  sessionId,
  runId,
  reportActionId: actionId,
  report: doneReportFixture,
} satisfies DomainReportEnvelopeV1;
