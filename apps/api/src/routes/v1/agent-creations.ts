import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Router } from "express";
import type { CreatorDirectTaskKind, DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";
import { mutation, route } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import { createAction, getAsset, getProject } from "@/lib/api/v1/store";
import { getDomainRun, listSessionRuns } from "@/lib/api/v1/domain-session-store";
import {
  enhanceImagePrompt,
  type ImagePromptEnhancementDeps,
} from "@/lib/api/v1/image-prompt-enhancement";
import { confirmCreatorDirectProposal } from "@/lib/postgres/creator-direct-confirmation";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";
import { cancelDomainRun, dispatchDomainRun } from "@/lib/orchestrator/domain-run-service";

export const agentCreationsRouter = Router();
const MAX_PROMPT_LENGTH = 4_000;
const MAX_BUDGET_USD = 100;

export type CreationRequest = {
  kind: CreatorDirectTaskKind;
  prompt: string;
  maximumUsd: number;
  sourceAssetId?: string;
  referenceAssetIds: string[];
  improvePrompt: boolean;
};

function object(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError("validation_failed", "Request body must be an object.");
  }
  return body as Record<string, unknown>;
}

function string(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new ApiError("validation_failed", `${field} must be a non-empty string of at most ${max} characters.`);
  }
  return value.trim();
}

function optionalBoolean(value: unknown, field: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new ApiError("validation_failed", `${field} must be a boolean.`);
  }
  return value;
}

export function parseCreation(body: unknown): CreationRequest {
  const value = object(body);
  const kind = string(value.kind, "kind", 64) as CreatorDirectTaskKind;
  if (!new Set<CreatorDirectTaskKind>(["image_create", "video_create", "video_edit", "soundtrack_create", "audio_create"]).has(kind)) {
    throw new ApiError("validation_failed", "kind must be Image, Video, Video Edit, Soundtrack, or Audio.");
  }
  const maximumUsd = Number(value.maximumUsd);
  if (!Number.isFinite(maximumUsd) || maximumUsd < 0 || maximumUsd > MAX_BUDGET_USD) {
    throw new ApiError("validation_failed", `maximumUsd must be between 0 and ${MAX_BUDGET_USD}.`);
  }
  const references = value.referenceAssetIds === undefined ? [] : value.referenceAssetIds;
  if (!Array.isArray(references) || references.length > 12 || references.some((id) => typeof id !== "string" || !id)) {
    throw new ApiError("validation_failed", "referenceAssetIds must contain at most 12 asset IDs.");
  }
  const sourceAssetId = value.sourceAssetId === undefined ? undefined : string(value.sourceAssetId, "sourceAssetId", 128);
  if (kind === "video_edit" && !sourceAssetId) {
    throw new ApiError("validation_failed", "video_edit requires a pinned sourceAssetId.");
  }
  return {
    kind,
    prompt: string(value.prompt, "prompt", MAX_PROMPT_LENGTH),
    maximumUsd,
    sourceAssetId,
    referenceAssetIds: references as string[],
    improvePrompt: optionalBoolean(value.improvePrompt, "improvePrompt"),
  };
}

export interface PreparedCreationRequest {
  request: CreationRequest;
  originalPrompt: string;
  enhancementApplied: boolean;
  enhancementPolicy: string | null;
}

export async function prepareCreationRequest(
  projectId: string,
  request: CreationRequest,
  deps: ImagePromptEnhancementDeps = {}
): Promise<PreparedCreationRequest> {
  if (request.kind !== "image_create" || !request.improvePrompt) {
    return {
      request,
      originalPrompt: request.prompt,
      enhancementApplied: false,
      enhancementPolicy: null,
    };
  }
  try {
    const enhancement = await enhanceImagePrompt(
      projectId,
      request.prompt,
      deps
    );
    return {
      request: { ...request, prompt: enhancement.effectivePrompt },
      originalPrompt: request.prompt,
      enhancementApplied: true,
      enhancementPolicy: enhancement.policy,
    };
  } catch {
    throw new ApiError(
      "model_output_invalid",
      "We couldn't improve this image prompt. Retry, or turn off Improve image prompt to continue with your original request."
    );
  }
}

export function creationRequestDigest(input: PreparedCreationRequest): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ...input.request,
        referenceAssetIds: [...input.request.referenceAssetIds].sort(),
        originalPrompt: input.originalPrompt,
        enhancementApplied: input.enhancementApplied,
        enhancementPolicy: input.enhancementPolicy,
      })
    )
    .digest("hex");
}

export function taskFor(args: { projectId: string; actorId: string; request: CreationRequest; requestDigest: string; approvalGateId: string; proposalActionId: string; sourceFingerprint?: string; idempotencyKey: string }): DomainTaskV1 {
  const visual = args.request.kind === "image_create" || args.request.kind === "video_create" || args.request.kind === "video_edit";
  const allowedOutputKinds = args.request.kind === "image_create" ? ["image"] as const : visual ? ["clip"] as const : ["audio_track"] as const;
  const sourceTargets = args.request.sourceAssetId ? [{ kind: "asset" as const, projectId: args.projectId, assetId: args.request.sourceAssetId }] : [];
  const referenceTargets = args.request.referenceAssetIds.map((assetId) => ({ kind: "asset" as const, projectId: args.projectId, assetId }));
  return {
    schemaVersion: "DomainTask.v1",
    domain: visual ? "visuals" : "audio",
    taskKind: args.request.kind,
    objective: args.request.prompt,
    instruction: args.request.prompt,
    targets: [{ kind: "project", projectId: args.projectId }, ...sourceTargets, ...referenceTargets],
    requiredOutputs: [{ kind: allowedOutputKinds[0], role: "creator_direct", minimumCount: 1 }],
    allowedOutputKinds,
    creativeConstraints: {},
    preserve: { assetIds: args.request.sourceAssetId ? [args.request.sourceAssetId] : [], selections: [], fingerprints: args.request.sourceAssetId && args.sourceFingerprint ? [{ assetId: args.request.sourceAssetId, value: args.sourceFingerprint }] : [], pins: args.request.sourceAssetId ? [{ kind: "asset", id: args.request.sourceAssetId, ...(args.sourceFingerprint ? { fingerprint: args.sourceFingerprint } : {}) }] : [] },
    candidateAffectedAssetIds: [], budgetUsd: args.request.maximumUsd,
    approvalContext: { proposalActionId: args.proposalActionId as never, approvedBudgetUsd: args.request.maximumUsd, approvalFingerprint: args.requestDigest },
    acceptanceCriteria: [args.request.prompt],
    origin: { kind: "creator_direct", actorId: args.actorId, creatorMessageId: args.requestDigest, entrypoint: "project_api", requestDigest: args.requestDigest, idempotencyKey: args.idempotencyKey, approvalGateId: args.approvalGateId },
    responseRecipient: { kind: "creator_conversation" },
  } as DomainTaskV1;
}

async function verifyReferences(workspaceId: string, projectId: string, request: CreationRequest) {
  await getProject(workspaceId, projectId);
  let sourceFingerprint: string | undefined;
  for (const assetId of [...request.referenceAssetIds, ...(request.sourceAssetId ? [request.sourceAssetId] : [])]) {
    const asset = await getAsset(workspaceId, projectId, assetId);
    if (assetId === request.sourceAssetId) sourceFingerprint = asset.contentHash;
  }
  if (request.kind === "video_edit" && !sourceFingerprint) {
    throw new ApiError("validation_failed", "video_edit sourceAssetId must have a current content fingerprint.");
  }
  return sourceFingerprint;
}

type DispatchInput = Parameters<typeof dispatchDomainRun>[0];
type ActionInput = Parameters<typeof createAction>[0];

interface CreationProposalGateInput {
  gateId: string;
  projectId: string;
  runId: string;
  proposalActionId: string;
  actorId: string;
  requestDigest: string;
  maximumUsd: number;
  approvalToken: string;
  expiresAt: string;
}

export interface CreationProposalDeps {
  verifyReferences?: typeof verifyReferences;
  prepareRequest?: typeof prepareCreationRequest;
  dispatch?: (input: DispatchInput) => Promise<{ sessionId: string; runId: string }>;
  createProposalAction?: (input: ActionInput) => Promise<{ id: string }>;
  createProposalGate?: (input: CreationProposalGateInput) => Promise<void>;
  randomId?: () => string;
  approvalToken?: () => string;
  now?: () => number;
}

async function defaultCreateProposalGate(
  input: CreationProposalGateInput
): Promise<void> {
  const tokenHash = createHash("sha256")
    .update(input.approvalToken)
    .digest("hex");
  const rows = await runQuery(
    "agentCreations.createProposalGate",
    getServiceSupabase().rpc("create_creator_direct_proposal_gate_with_id", {
      p_gate_id: input.gateId,
      p_project_id: input.projectId,
      p_run_id: input.runId,
      p_proposal_action_id: input.proposalActionId,
      p_actor_id: input.actorId,
      p_request_digest: input.requestDigest,
      p_approved_max_usd: input.maximumUsd,
      p_approval_token_hash: tokenHash,
      p_expires_at: input.expiresAt,
    })
  );
  if (!(rows as Array<{ gate_id: string }>)[0]?.gate_id) {
    throw new ApiError(
      "internal_error",
      "Creator-direct proposal gate was not created."
    );
  }
}

export async function createCreationProposal(
  input: {
    workspaceId: string;
    actorId: string;
    projectId: string;
    requested: CreationRequest;
    idempotencyKey: string;
  },
  deps: CreationProposalDeps = {}
) {
  const verify = deps.verifyReferences ?? verifyReferences;
  const prepare = deps.prepareRequest ?? prepareCreationRequest;
  const dispatch = deps.dispatch ?? dispatchDomainRun;
  const createProposalAction = deps.createProposalAction ?? createAction;
  const createProposalGate =
    deps.createProposalGate ?? defaultCreateProposalGate;
  const randomId = deps.randomId ?? randomUUID;
  const makeApprovalToken =
    deps.approvalToken ?? (() => randomBytes(24).toString("base64url"));
  const now = deps.now ?? Date.now;

  const sourceFingerprint = await verify(
    input.workspaceId,
    input.projectId,
    input.requested
  );
  const prepared = await prepare(
    input.projectId,
    input.requested
  );
  const request = prepared.request;
  const requestDigest = creationRequestDigest(prepared);
  const approvalToken = makeApprovalToken();
  const proposalActionId = randomId();
  const gateId = randomId();
  const dispatchResult = await dispatch({
    projectId: input.projectId,
    domain:
      request.kind === "soundtrack_create" || request.kind === "audio_create"
        ? "audio"
        : "visuals",
    task: taskFor({
      projectId: input.projectId,
      actorId: input.actorId,
      request,
      requestDigest,
      approvalGateId: gateId,
      proposalActionId,
      sourceFingerprint,
      idempotencyKey: input.idempotencyKey,
    }),
    inputSummary: request.prompt,
    budgetUsd: request.maximumUsd,
    origin: {
      kind: "creator_direct",
      actorId: input.actorId,
      request: { requestDigest },
    },
    enqueue: false,
    idempotencyKey: input.idempotencyKey,
  });
  const proposal = await createProposalAction({
    id: proposalActionId,
    projectId: input.projectId,
    orchestratorRunId: dispatchResult.runId,
    tool: "creator_direct_proposal",
    status: "proposed",
    params: {
      kind: request.kind,
      requestDigest,
      maximumUsd: request.maximumUsd,
      promptEnhancement: {
        requested: input.requested.improvePrompt,
        applied: prepared.enhancementApplied,
        policy: prepared.enhancementPolicy,
        originalPrompt: prepared.originalPrompt,
        effectivePrompt: request.prompt,
      },
    },
    rationale: request.prompt,
    proposal: { maximumUsd: request.maximumUsd },
  });
  const expiresAt = new Date(now() + 15 * 60_000).toISOString();
  await createProposalGate({
    gateId,
    projectId: input.projectId,
    runId: dispatchResult.runId,
    proposalActionId: proposal.id,
    actorId: input.actorId,
    requestDigest,
    maximumUsd: request.maximumUsd,
    approvalToken,
    expiresAt,
  });
  return {
    sessionId: dispatchResult.sessionId,
    runId: dispatchResult.runId,
    gateId,
    requestDigest,
    maximumUsd: request.maximumUsd,
    approvalToken,
    expiresAt,
    effectivePrompt: request.prompt,
    enhancementApplied: prepared.enhancementApplied,
  };
}

agentCreationsRouter.post("/projects/:projectId/agent-creations/proposals", mutation(async ({ auth, body, req }, params) => {
  const projectId = string(params.projectId, "projectId", 128);
  const idempotencyKey = req.header("Idempotency-Key");
  if (!idempotencyKey) throw new ApiError("validation_failed", "Idempotency-Key is required to create a proposal.");
  const requested = parseCreation(body);
  const proposal = await createCreationProposal({
    workspaceId: auth.workspaceId,
    actorId: auth.actor.id,
    projectId,
    requested,
    idempotencyKey,
  });
  return { status: 201, body: { proposal } };
}));

agentCreationsRouter.post("/projects/:projectId/agent-creations/proposals/:gateId/confirm", mutation(async ({ auth, body, req }, params) => {
  const projectId = string(params.projectId, "projectId", 128); const value = object(body);
  const requestDigest = string(value.requestDigest, "requestDigest", 128); const approvalToken = string(value.approvalToken, "approvalToken", 256); const maximumUsd = Number(value.maximumUsd);
  const key = req.header("Idempotency-Key"); if (!key) throw new ApiError("validation_failed", "Idempotency-Key is required to confirm a proposal.");
  const confirmation = await confirmCreatorDirectProposal({ workspaceId: auth.workspaceId, projectId, actorId: auth.actor.id, gateId: string(params.gateId, "gateId", 128), requestDigest, approvedMaxUsd: maximumUsd, approvalToken, idempotencyKey: key });
  const run = await getDomainRun(projectId, confirmation.runId); if (!run?.agentSessionId) throw new ApiError("not_found", "Creator-direct run not found.");
  return { status: 202, body: { sessionId: run.agentSessionId, runId: run.id, enqueued: confirmation.dispatchEnqueued } };
}));

agentCreationsRouter.get("/projects/:projectId/agent-creations/:runId", route(async ({ auth }, params) => {
  const projectId = string(params.projectId, "projectId", 128); await getProject(auth.workspaceId, projectId);
  const run = await getDomainRun(projectId, string(params.runId, "runId", 128));
  if (!run || run.originKind !== "creator_direct" || run.originActorId !== auth.actor.id) throw new ApiError("not_found", "Creator-direct run not found.");
  const history = run.agentSessionId ? await listSessionRuns(run.agentSessionId, "service") : [];
  const report = history.find((entry) => entry.runId === run.id)?.report ?? null;
  return { status: 200, body: { sessionId: run.agentSessionId, run, report, outputs: report?.outcome.outcome === "done" ? report.outcome.outputs : [] } };
}));

agentCreationsRouter.post("/projects/:projectId/agent-creations/:runId/cancel", mutation(async ({ auth }, params) => {
  const projectId = string(params.projectId, "projectId", 128); await getProject(auth.workspaceId, projectId);
  const run = await getDomainRun(projectId, string(params.runId, "runId", 128));
  if (!run || run.originKind !== "creator_direct" || run.originActorId !== auth.actor.id) throw new ApiError("not_found", "Creator-direct run not found.");
  return { status: 200, body: { canceled: await cancelDomainRun({ projectId, runId: run.id }) } };
}));
