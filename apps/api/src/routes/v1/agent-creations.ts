import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Router } from "express";
import type { CreatorDirectTaskKind, DomainTaskV1 } from "@popcorn/shared/domain-agent-contract";
import { mutation, route } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import { createAction, getAsset, getProject } from "@/lib/api/v1/store";
import { getDomainRun, listSessionRuns } from "@/lib/api/v1/domain-session-store";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { runQuery } from "@/lib/supabase/db-errors";
import { cancelDomainRun, dispatchDomainRun } from "@/lib/orchestrator/domain-run-service";

export const agentCreationsRouter = Router();
const MAX_PROMPT_LENGTH = 4_000;
const MAX_BUDGET_USD = 100;

type CreationRequest = {
  kind: CreatorDirectTaskKind;
  prompt: string;
  maximumUsd: number;
  sourceAssetId?: string;
  referenceAssetIds: string[];
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

function parseCreation(body: unknown): CreationRequest {
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
  return { kind, prompt: string(value.prompt, "prompt", MAX_PROMPT_LENGTH), maximumUsd, sourceAssetId, referenceAssetIds: references as string[] };
}

function digest(input: CreationRequest): string {
  return createHash("sha256").update(JSON.stringify({ ...input, referenceAssetIds: [...input.referenceAssetIds].sort() })).digest("hex");
}

function taskFor(args: { projectId: string; actorId: string; request: CreationRequest; requestDigest: string; approvalGateId: string; proposalActionId: string; sourceFingerprint?: string; idempotencyKey: string }): DomainTaskV1 {
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

agentCreationsRouter.post("/projects/:projectId/agent-creations/proposals", mutation(async ({ auth, body, req }, params) => {
  const projectId = string(params.projectId, "projectId", 128);
  const request = parseCreation(body);
  const sourceFingerprint = await verifyReferences(auth.workspaceId, projectId, request);
  const requestDigest = digest(request);
  const approvalToken = randomBytes(24).toString("base64url");
  const idempotencyKey = req.header("Idempotency-Key");
  if (!idempotencyKey) throw new ApiError("validation_failed", "Idempotency-Key is required to create a proposal.");
  const proposalActionId = randomUUID();
  const gateId = randomUUID();
  // The finite run is deliberately not enqueued until the one-use gate is consumed.
  const dispatch = await dispatchDomainRun({ projectId, domain: request.kind === "soundtrack_create" || request.kind === "audio_create" ? "audio" : "visuals", task: taskFor({ projectId, actorId: auth.actor.id, request, requestDigest, approvalGateId: gateId, proposalActionId, sourceFingerprint, idempotencyKey }), inputSummary: request.prompt, budgetUsd: request.maximumUsd, origin: { kind: "creator_direct", actorId: auth.actor.id, request: { requestDigest } }, enqueue: false, idempotencyKey });
  const proposal = await createAction({ id: proposalActionId, projectId, orchestratorRunId: dispatch.runId, tool: "creator_direct_proposal", status: "proposed", params: { kind: request.kind, requestDigest, maximumUsd: request.maximumUsd }, rationale: request.prompt, proposal: { maximumUsd: request.maximumUsd } });
  const tokenHash = createHash("sha256").update(approvalToken).digest("hex");
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const rows = await runQuery("agentCreations.createProposalGate", getServiceSupabase().rpc("create_creator_direct_proposal_gate_with_id", { p_gate_id: gateId, p_project_id: projectId, p_run_id: dispatch.runId, p_proposal_action_id: proposal.id, p_actor_id: auth.actor.id, p_request_digest: requestDigest, p_approved_max_usd: request.maximumUsd, p_approval_token_hash: tokenHash, p_expires_at: expiresAt }));
  if (!(rows as Array<{ gate_id: string }>)[0]?.gate_id) throw new ApiError("internal_error", "Creator-direct proposal gate was not created.");
  return { status: 201, body: { proposal: { sessionId: dispatch.sessionId, runId: dispatch.runId, gateId, requestDigest, maximumUsd: request.maximumUsd, approvalToken, expiresAt } } };
}));

agentCreationsRouter.post("/projects/:projectId/agent-creations/proposals/:gateId/confirm", mutation(async ({ auth, body, req }, params) => {
  const projectId = string(params.projectId, "projectId", 128); const value = object(body);
  const requestDigest = string(value.requestDigest, "requestDigest", 128); const approvalToken = string(value.approvalToken, "approvalToken", 256); const maximumUsd = Number(value.maximumUsd);
  const key = req.header("Idempotency-Key"); if (!key) throw new ApiError("validation_failed", "Idempotency-Key is required to confirm a proposal.");
  const rows = await runQuery("agentCreations.confirmProposal", getServiceSupabase().rpc("consume_creator_direct_proposal_gate", { p_gate_id: string(params.gateId, "gateId", 128), p_project_id: projectId, p_actor_id: auth.actor.id, p_request_digest: requestDigest, p_approved_max_usd: maximumUsd, p_approval_token: approvalToken, p_idempotency_key: key }));
  const row = (rows as Array<{ run_id: string; dispatch_enqueued: boolean }>)[0]; if (!row) throw new ApiError("validation_failed", "Proposal confirmation was rejected.");
  const run = await getDomainRun(projectId, row.run_id); if (!run?.agentSessionId) throw new ApiError("not_found", "Creator-direct run not found.");
  return { status: 202, body: { sessionId: run.agentSessionId, runId: run.id, enqueued: row.dispatch_enqueued } };
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
