// PR2: Generated Asset Endpoint For Agents.
//
// Turns an agent generation request into a normal project asset (in the PR1
// asset store) with full provenance, modeled as an `asset_generation` job.
// Reuses the existing preflight + provider pipeline; adds typed errors and
// actual audio-duration capture. Idempotency is handled by the shared
// handleMutation wrapper, so this module stays framework-free and testable.

import { resolveWorkspaceGenerationModel } from "./model-settings";
import { estimateCostUsd } from "@/lib/generative/pricing";
import { recordModelCallCost } from "./model-call-costs";
import {
  releaseOrchestratorBudget,
  recordOrchestratorBudgetBilling,
  reserveOrchestratorBudget,
  settleOrchestratorBudget,
} from "./orchestrator-budget-controls";
import { reserveRerunChildBudget } from "./rerun-lifecycle-store";
import { getDomainRun } from "./domain-session-store";
import { billableUsdSoFar, currentRunUserId, noteInternallyHandledBillableGeneration } from "@/lib/provider-keys/resolve";
import {
  GenerativeProviderName,
} from "@popcorn/shared/generative/types";
import { randomUUID } from "crypto";
import type { Job } from "@popcorn/shared/v1/types";
import type { V1Job } from "./jobs";
import { AuthContext } from "./auth";
import { ApiError, ApiErrorCode, validationError } from "./errors";
import {
  actionToolForParsed,
  buildGenerationActionProposal,
  generatedAssetIdempotentActionId,
  generatedAssetLlmCostScope,
  generatedInputAssetIds,
  pooledImageRevisionWriteContext,
  resolveGeneratedAssetMetadataWithCost,
  stageItemKindForAssetKind,
  type RunStageHandle,
  type RunStageItemHandle,
} from "./generated-asset-support";
export {
  generatedAssetIdempotentActionId,
  generatedAssetLlmCostScope,
  pooledImageRevisionWriteContext,
  resolveGeneratedAssetMetadataWithCost,
} from "./generated-asset-support";
import {
  canonicalizeAssetIds,
  claimProviderJobExecution,
  completeProviderJobExecution,
  createJob,
  createOrGetJob,
  createAction,
  getAssetFingerprintPins,
  getAsset,
  getJob,
  getProject,
  renewProviderJobExecution,
  updateAction,
  V1Action,
  V1Asset,
} from "./store";
import {
  parseGeneratedAssetRequest,
  PROVIDER_KIND_SUPPORT,
  type ParsedRequest,
} from "./generated-asset-request";
import { getRunSessionClaim } from "./domain-session-store";
import { runGeneration } from "./generated-asset-generation";
import { createLogger } from "@/lib/v1/logger";

const logger = createLogger();

export interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

export type GeneratedAssetJob = V1Job & {
  type: "asset_generation";
  actionId?: string;
  sessionClaimGeneration?: number;
};

export function resolveGeneratedAssetClaimGeneration(
  currentClaimGeneration: number | undefined,
  suppliedClaimGeneration: number | undefined
): number | undefined {
  if (
    currentClaimGeneration !== undefined &&
    suppliedClaimGeneration === undefined
  ) {
    throw new ApiError(
      "job_failed",
      "An active domain run requires its exact session claim generation."
    );
  }
  if (
    suppliedClaimGeneration !== undefined &&
    suppliedClaimGeneration !== currentClaimGeneration
  ) {
    throw new ApiError(
      "job_failed",
      "The domain-session claim changed before generated-asset job creation."
    );
  }
  return suppliedClaimGeneration;
}

function asGeneratedAssetJob(job: Job): GeneratedAssetJob {
  if (job.type !== "asset_generation") {
    throw new ApiError("internal_error", `Expected an asset_generation job: ${job.id}.`);
  }
  return job as unknown as GeneratedAssetJob;
}

function toGenerationErrorSummary(error: ApiError, fallbackCode = "job_failed") {
  return {
    code: error.code || fallbackCode,
    message: error.message,
    retryable: error.status >= 500,
  };
}

export async function reserveGeneratedAssetProviderBudget(
  input: {
    projectId: string;
    runId?: string;
    actionId: string;
    jobId: string;
    reservationKey: string;
    estimatedUsd: number;
  },
  deps: {
    getDomainRun: typeof getDomainRun;
    reserveRerunChildBudget: typeof reserveRerunChildBudget;
    reserveOrchestratorBudget: typeof reserveOrchestratorBudget;
  } = {
    getDomainRun,
    reserveRerunChildBudget,
    reserveOrchestratorBudget,
  }
) {
  const proposalRun = input.runId
    ? await deps.getDomainRun(input.projectId, input.runId)
    : null;
  const approval = proposalRun?.taskParams?.approvalContext;
  const callback = approval?.rerunCallback;
  if (callback && approval?.executionReservationId && input.runId) {
    return deps.reserveRerunChildBudget({
      projectId: input.projectId,
      executionReservationId: approval.executionReservationId,
      workItemId: callback.workItemId,
      actionId: input.actionId,
      childRunId: input.runId,
      jobId: input.jobId,
      reservationKey: input.reservationKey,
      estimatedUsd: input.estimatedUsd,
    });
  }
  return deps.reserveOrchestratorBudget({
    projectId: input.projectId,
    runId: input.runId,
    actionId: input.actionId,
    jobId: input.jobId,
    reservationKey: input.reservationKey,
    estimatedUsd: input.estimatedUsd,
  });
}

export interface CreateGeneratedAssetArgs {
  auth: AuthContext;
  projectId: string;
  body: unknown;
  actionId?: string;
  sessionClaimGeneration?: number;
  idempotencyKey?: string;
  expectedAssetPins?: GeneratedAssetInputPin[];
  budget?: GeneratedAssetBudgetAdmission;
  progress?: RunStageHandle;
}

interface GeneratedAssetJobInput {
  body: unknown;
  expectedAssetPins?: GeneratedAssetInputPin[];
}

export interface GeneratedAssetInputPin {
  assetId: string;
  contentHash: string | null;
  inputsFingerprint: string | null;
}

export interface GeneratedAssetBudgetAdmission {
  reservationKey: string;
  approvedMaxUsd: number;
  reserve(input: {
    actionId: string;
    jobId: string;
    reservationKey: string;
    estimatedUsd: number;
  }): Promise<unknown>;
}

const PROMPT_PREVIEW_MAX = 240;
const PROVIDER_CLAIM_STALE_MS = 15 * 60_000;
const PROVIDER_CLAIM_HEARTBEAT_MS = 30_000;

function clipPromptPreview(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= PROMPT_PREVIEW_MAX) return trimmed;
  return `${trimmed.slice(0, PROMPT_PREVIEW_MAX - 1)}…`;
}

export async function createGeneratedAsset(
  args: CreateGeneratedAssetArgs
): Promise<ApiResult> {
  const {
    auth,
    projectId,
    body,
    actionId,
    sessionClaimGeneration,
    idempotencyKey,
    expectedAssetPins,
    budget,
    progress,
  } = args;
  const job = await enqueueGeneratedAssetJob({
    auth,
    projectId,
    body,
    actionId,
    sessionClaimGeneration,
    idempotencyKey,
    expectedAssetPins,
  });
  const finished = await runGeneratedAssetJob({
    auth,
    projectId,
    jobId: job.id,
    budget,
    progress,
  });
  if (finished.status === "failed") {
    throw new ApiError(
      (finished.error?.code as ApiErrorCode | undefined) || "job_failed",
      finished.error?.message || "Asset generation failed."
    );
  }
  return { status: 202, body: { job: finished } };
}

export async function startGeneratedAssetJob(
  args: CreateGeneratedAssetArgs
): Promise<ApiResult> {
  const {
    auth,
    projectId,
    body,
    actionId,
    sessionClaimGeneration,
    idempotencyKey,
    expectedAssetPins,
    budget,
    progress,
  } = args;
  const job = await enqueueGeneratedAssetJob({
    auth,
    projectId,
    body,
    actionId,
    sessionClaimGeneration,
    idempotencyKey,
    expectedAssetPins,
  });
  void runGeneratedAssetJob({
    auth,
    projectId,
    jobId: job.id,
    budget,
    progress,
  }).catch((err) => {
    logger.error("generated_asset.background_job_failed", {
      workspaceId: auth.workspaceId,
      projectId,
      jobId: job.id,
      error: { message: err instanceof Error ? err.message : String(err) },
    });
  });
  return { status: 202, body: { job } };
}

export async function enqueueGeneratedAssetJob(
  args: Pick<
    CreateGeneratedAssetArgs,
    | "auth"
    | "projectId"
    | "body"
    | "actionId"
    | "sessionClaimGeneration"
    | "idempotencyKey"
    | "expectedAssetPins"
  >
): Promise<V1Job> {
  const {
    auth,
    projectId,
    body,
    actionId,
    sessionClaimGeneration,
    idempotencyKey,
    expectedAssetPins,
  } = args;

  await getProject(auth.workspaceId, projectId); // throws not_found
  const parsed = parseGeneratedAssetRequest(body);
  let durableBody = body;
  if (!parsed.providerWasExplicit) {
    const resolved = await resolveWorkspaceGenerationModel({
      workspaceId: auth.workspaceId,
      kind: parsed.kind,
      explicitModel: parsed.model,
    });
    parsed.provider = resolved.provider;
    parsed.model = resolved.model;
    const supportedKinds = PROVIDER_KIND_SUPPORT[parsed.provider];
    if (!supportedKinds?.includes(parsed.kind)) {
      throw validationError("The request body is invalid.", [
        {
          path: "provider",
          message: `Provider "${parsed.provider}" supports ${supportedKinds?.join(", ") || "no"} generation, not ${parsed.kind}.`,
        },
      ]);
    }
    durableBody = {
      ...(body as Record<string, unknown>),
      provider: parsed.provider,
      ...(parsed.model ? { model: parsed.model } : {}),
    };
  }
  // Persist the action's graph references in canonical UUID form before the
  // durable job can be claimed. The provider boundary must never be the first
  // point at which its provenance becomes valid relational data.
  parsed.referenceAssetIds = await canonicalizeAssetIds(
    auth.workspaceId,
    projectId,
    parsed.referenceAssetIds
  );
  if (parsed.editSourceAssetId) {
    const [editSourceAssetId] = await canonicalizeAssetIds(
      auth.workspaceId,
      projectId,
      [parsed.editSourceAssetId]
    );
    parsed.editSourceAssetId = editSourceAssetId;
  }
  if (parsed.sourceAssetId) {
    const [sourceAssetId] = await canonicalizeAssetIds(
      auth.workspaceId,
      projectId,
      [parsed.sourceAssetId]
    );
    parsed.sourceAssetId = sourceAssetId;
    durableBody = {
      ...(durableBody as Record<string, unknown>),
      sourceAssetId,
    };
  }
  parsed.anchorIds = await canonicalizeAssetIds(auth.workspaceId, projectId, parsed.anchorIds);
  if (parsed.graphInputs?.length) {
    const canonical = await canonicalizeAssetIds(
      auth.workspaceId,
      projectId,
      parsed.graphInputs.map((input) => input.assetId)
    );
    parsed.graphInputs = parsed.graphInputs.map((input, index) => ({
      ...input,
      assetId: canonical[index],
    }));
  }
  let durableAssetPins = expectedAssetPins;
  if (expectedAssetPins?.length) {
    const canonical = await canonicalizeAssetIds(
      auth.workspaceId,
      projectId,
      expectedAssetPins.map((pin) => pin.assetId)
    );
    durableAssetPins = expectedAssetPins.map((pin, index) => ({
      ...pin,
      assetId: canonical[index]!,
    }));
    const inputs = new Set(generatedInputAssetIds(parsed));
    const pins = new Set(durableAssetPins.map((pin) => pin.assetId));
    if (
      pins.size !== durableAssetPins.length ||
      inputs.size !== pins.size ||
      [...inputs].some((assetId) => !pins.has(assetId))
    ) {
      throw new ApiError(
        "validation_failed",
        "Durable asset pins must exactly cover generated-asset inputs."
      );
    }
  }
  // Validate domain ownership before creating an action or launching any
  // provider work. Public/direct callers cannot borrow an active run's claim.
  const sessionClaim = parsed.runId ? await getRunSessionClaim(parsed.runId) : null;
  const durableClaimGeneration = resolveGeneratedAssetClaimGeneration(
    sessionClaim?.claimGeneration,
    sessionClaimGeneration
  );
  const canonicalActionId =
    actionId ??
    (idempotencyKey
      ? generatedAssetIdempotentActionId({
          workspaceId: auth.workspaceId,
          projectId,
          idempotencyKey,
        })
      : randomUUID());
  const action = await createAction({
    id: canonicalActionId,
    projectId,
    orchestratorRunId: parsed.runId,
    tool: actionToolForParsed(parsed),
    status: "running",
    params: {
      provider: parsed.provider,
      kind: parsed.kind,
      model: parsed.model,
      prompt: parsed.prompt,
      displayName: parsed.displayName,
      slug: parsed.slug,
      durationSec: parsed.durationSec,
      audioMode: parsed.audioMode,
      voiceId: parsed.voiceId,
      voiceSettings: parsed.voiceSettings,
      forceInstrumental: parsed.forceInstrumental,
      sourceAssetId: parsed.sourceAssetId,
      referenceAssetIds: parsed.referenceAssetIds,
      beatId: parsed.beatId,
      anchorIds: parsed.anchorIds,
      graphInputs: parsed.graphInputs,
    },
    inputAssetIds: generatedInputAssetIds(parsed),
    rationale: `Generate a ${parsed.kind} asset for the project.`,
  });

  // A job launched under a domain-session claim carries the session's durable
  // claim generation; finalization writes are fenced against the session's
  // current generation so a stale, reclaimed worker cannot commit late. Runs
  // outside a session (root runs, direct requests) carry none.
  const createJobInput = {
    workspaceId: auth.workspaceId,
    projectId,
    type: "asset_generation",
    status: "queued",
    progress: { currentStep: "queued", percent: 0 },
    payload: {
      body: durableBody,
      ...(durableAssetPins?.length ? { expectedAssetPins: durableAssetPins } : {}),
    } satisfies GeneratedAssetJobInput,
    result: null,
    actionId: action.id,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(durableClaimGeneration !== undefined
      ? { sessionClaimGeneration: durableClaimGeneration }
      : {}),
  } as const;
  const job = idempotencyKey
    ? (await createOrGetJob(createJobInput)).job
    : await createJob(createJobInput);
  await updateAction(action.id, { jobIds: [job.id] });
  return asGeneratedAssetJob(job);
}

function generatedAssetJobInput(job: GeneratedAssetJob): GeneratedAssetJobInput {
  const input = job.input as GeneratedAssetJobInput | null | undefined;
  if (!input || !("body" in input)) {
    throw new ApiError(
      "job_failed",
      `Generated-asset job is missing durable input: ${job.id}.`
    );
  }
  return input;
}

export async function runGeneratedAssetJob(args: {
  auth: AuthContext;
  projectId: string;
  jobId: string;
  budget?: GeneratedAssetBudgetAdmission;
  progress?: RunStageHandle;
}): Promise<GeneratedAssetJob> {
  const { auth, projectId, jobId, budget, progress } = args;
  await getProject(auth.workspaceId, projectId); // throws not_found

  const job = await getJob(auth.workspaceId, projectId, jobId);
  if (
    !job ||
    job.workspaceId !== auth.workspaceId ||
    job.projectId !== projectId ||
    job.type !== "asset_generation"
  ) {
    throw new ApiError("not_found", `Generated-asset job not found: ${jobId}.`);
  }
  if (job.status === "succeeded" || job.status === "failed" || job.status === "canceled") {
    return asGeneratedAssetJob(job);
  }
  const generatedJob = asGeneratedAssetJob(job);

  const claim = await claimProviderJobExecution({
    workspaceId: auth.workspaceId,
    projectId,
    jobId: job.id,
    staleBefore: new Date(Date.now() - PROVIDER_CLAIM_STALE_MS).toISOString(),
  });
  if (claim.state !== "claimed") {
    const current = await getJob(auth.workspaceId, projectId, job.id);
    return asGeneratedAssetJob(current);
  }
  if (!claim.claimToken) {
    throw new ApiError("internal_error", "Provider job claim was missing its token.");
  }
  const claimHeartbeat = setInterval(() => {
    void renewProviderJobExecution({
      workspaceId: auth.workspaceId,
      projectId,
      jobId: job.id,
      claimToken: claim.claimToken!,
    }).catch((err) => {
      logger.error("generated_asset.provider_claim_renewal_failed", {
        workspaceId: auth.workspaceId,
        projectId,
        jobId: job.id,
        error: { message: err instanceof Error ? err.message : String(err) },
      });
    });
  }, PROVIDER_CLAIM_HEARTBEAT_MS);

  const running = generatedJob;
  let action: V1Action | null = null;
  let item: RunStageItemHandle | null = null;
  let parsed: ParsedRequest | null = null;
  let estimatedCostUsd = 0;
  const budgetReservationKey =
    budget?.reservationKey ?? `generated-asset:${running.id}`;
  let budgetReserved = false;
  let modelCostRecorded = false;
  const billableBeforeUsd = billableUsdSoFar();

  try {
    if (!running.actionId) {
      throw new ApiError(
        "job_failed",
        `Generated-asset job is missing canonical action attribution: ${running.id}.`
      );
    }
    parsed = parseGeneratedAssetRequest(generatedAssetJobInput(generatedJob).body);
    for (const pin of generatedAssetJobInput(generatedJob).expectedAssetPins ?? []) {
      const current = await getAsset(auth.workspaceId, projectId, pin.assetId);
      if (
        (current.contentHash ?? null) !== pin.contentHash ||
        (current.inputsFingerprint ?? null) !== pin.inputsFingerprint
      ) {
        throw new ApiError(
          "validation_failed",
          `Approved asset input changed before provider execution: ${pin.assetId}.`,
          { assetIds: [pin.assetId], reason: "stale_asset_pin" }
        );
      }
    }
    if (!parsed.providerWasExplicit) {
      const resolved = await resolveWorkspaceGenerationModel({
        workspaceId: auth.workspaceId,
        kind: parsed.kind,
        explicitModel: parsed.model,
      });
      parsed.provider = resolved.provider;
      parsed.model = resolved.model;
      const supportedKinds = PROVIDER_KIND_SUPPORT[parsed.provider];
      if (!supportedKinds?.includes(parsed.kind)) {
        throw validationError("The request body is invalid.", [
          {
            path: "provider",
            message: `Provider "${parsed.provider}" supports ${supportedKinds?.join(", ") || "no"} generation, not ${parsed.kind}.`,
          },
        ]);
      }
    }
    // The agent may reference inputs by slug (e.g. "character_homeowner"). Resolve
    // every asset reference to its canonical uuid BEFORE these values are written to
    // uuid columns (createAction.input_asset_ids, asset_edges via graphInputs), or
    // Postgres rejects the raw slug with 22P02. See store.canonicalizeAssetIds.
    parsed.referenceAssetIds = await canonicalizeAssetIds(
      auth.workspaceId,
      projectId,
      parsed.referenceAssetIds
    );
    if (parsed.editSourceAssetId) {
      const [editSourceAssetId] = await canonicalizeAssetIds(
        auth.workspaceId,
        projectId,
        [parsed.editSourceAssetId]
      );
      parsed.editSourceAssetId = editSourceAssetId;
    }
    if (parsed.sourceAssetId) {
      const [sourceAssetId] = await canonicalizeAssetIds(
        auth.workspaceId,
        projectId,
        [parsed.sourceAssetId]
      );
      parsed.sourceAssetId = sourceAssetId;
    }
    parsed.anchorIds = await canonicalizeAssetIds(auth.workspaceId, projectId, parsed.anchorIds);
    if (parsed.graphInputs?.length) {
      const canonical = await canonicalizeAssetIds(
        auth.workspaceId,
        projectId,
        parsed.graphInputs.map((input) => input.assetId)
      );
      parsed.graphInputs = parsed.graphInputs.map((input, index) => ({
        ...input,
        assetId: canonical[index],
      }));
    }
    estimatedCostUsd = estimateCostUsd({
      provider: parsed.provider,
      kind: parsed.kind,
      durationSec: parsed.durationSec,
      model: parsed.model,
    });
    if (budget && estimatedCostUsd > budget.approvedMaxUsd) {
      throw new ApiError(
        "budget_exceeded",
        "Canonical provider estimate exceeds the approved proposal maximum.",
        { estimatedCostUsd, approvedMaxCostUsd: budget.approvedMaxUsd }
      );
    }
    const pinnedFingerprints = await getAssetFingerprintPins(
      projectId,
      generatedInputAssetIds(parsed)
    );
    // The job/action were preallocated when the durable request was accepted.
    // Reserve against the root-family ceiling before any provider call can
    // begin; concurrent finite children serialize inside the RPC.
    if (budget) {
      await budget.reserve({
        actionId: running.actionId,
        jobId: running.id,
        reservationKey: budgetReservationKey,
        estimatedUsd: estimatedCostUsd,
      });
      budgetReserved = true;
    } else {
      const budgetReservation = await reserveGeneratedAssetProviderBudget({
        projectId,
        runId: parsed.runId,
        actionId: running.actionId,
        jobId: running.id,
        reservationKey: budgetReservationKey,
        estimatedUsd: estimatedCostUsd,
      });
      budgetReserved = budgetReservation !== null;
    }
    action = await createAction({
      id: running.actionId,
      projectId,
      orchestratorRunId: parsed.runId,
      tool: actionToolForParsed(parsed),
      status: "running",
      params: {
        provider: parsed.provider,
        kind: parsed.kind,
        model: parsed.model,
        prompt: parsed.prompt,
        displayName: parsed.displayName,
        slug: parsed.slug,
        durationSec: parsed.durationSec,
        referenceAssetIds: parsed.referenceAssetIds,
        beatId: parsed.beatId,
        anchorIds: parsed.anchorIds,
      },
      inputAssetIds: generatedInputAssetIds(parsed),
      rationale: `Generate a ${parsed.kind} asset for the project.`,
      proposal: buildGenerationActionProposal({
        parsed,
        jobId: running.id,
        estimatedCostUsd,
        pinnedFingerprints,
      }),
      jobIds: [running.id],
    });

    // Reserve this call's cost up front (linked to the generation action), so
    // concurrent generations in the same run see each other's in-flight spend in
    // the budget check rather than both passing a one-call budget. Cost is
    // deterministic from the request; we record the estimate now and don't double
    // count it later. (is_estimate stays true until rates/usage are measured.)
    if (estimatedCostUsd > 0) {
      await recordModelCallCost({
        projectId,
        runId: parsed.runId,
        actionId: action.id,
        provider: parsed.provider,
        model: parsed.model,
        unit: parsed.kind === "image" ? "images" : "seconds",
        quantity: parsed.kind === "image" ? 1 : parsed.durationSec ?? 0,
        costUsd: estimatedCostUsd,
        idempotencyKey: budgetReservationKey,
      });
      modelCostRecorded = true;
    }

    // Bind a stage item to this asset so the progress UI can show a per-asset
    // card. The item lives for the duration of this call and is closed before
    // the function returns (success, validation failure, or provider error).
    item = progress
      ? await progress.startItem({
          kind: stageItemKindForAssetKind(parsed.kind),
          label:
            parsed.description ||
            clipPromptPreview(parsed.prompt) ||
            `Generated ${parsed.kind}`,
          provider: parsed.provider,
          prompt: parsed.prompt,
          promptPreview: clipPromptPreview(parsed.prompt),
        })
      : null;
    if (progress) await progress.attachJob(running.id);

    const asset = await runGeneration(
      auth,
      projectId,
      parsed,
      item,
      action,
      running.sessionClaimGeneration
    );
    const billableUsd = Math.max(0, billableUsdSoFar() - billableBeforeUsd);
    const billingUserId = currentRunUserId();
    if (budgetReserved) {
      // The durable operation settlement owns this debit. Exclude it from the
      // outer engine's tool-level settlement, even if recovery must finish the
      // reservation later.
      noteInternallyHandledBillableGeneration(billableUsd);
    }
    if (budgetReserved && billingUserId) {
      await recordOrchestratorBudgetBilling({
        projectId,
        reservationKey: budgetReservationKey,
        billingUserId,
        billableUsd,
      });
    }
    const finished = await completeProviderJobExecution({
      workspaceId: auth.workspaceId,
      projectId,
      jobId: running.id,
      claimToken: claim.claimToken,
      status: "succeeded",
      progress: { currentStep: "saving_artifact", percent: 100 },
      result: { assetIds: [asset.id] },
      error: null,
      actionOutputAssetIds: [asset.id],
    });
    if (!finished) return getJob(auth.workspaceId, projectId, running.id).then(asGeneratedAssetJob);
    if (budgetReserved) {
      // The accepted request's deterministic provider estimate is the current
      // settlement value. This replay-safe transition ensures an admitted
      // operation never holds family headroom forever.
      try {
        await settleOrchestratorBudget({
          projectId,
          reservationKey: budgetReservationKey,
          actualUsd: estimatedCostUsd,
          billingUserId: billingUserId ?? undefined,
          billableUsd,
        });
      } catch (settlementError) {
        // Do not rewrite a completed provider job as failed because an
        // accounting retry is needed; the recovery sweep can settle this
        // durable reservation by its stable action/job identity.
        logger.error("generated_asset.budget_settlement_failed", {
          projectId,
          jobId: running.id,
          error: { message: settlementError instanceof Error ? settlementError.message : String(settlementError) },
        });
      }
    }
    if (item) {
      await item.succeed({
        assetId: asset.id,
        message: `Generated ${parsed.kind}.`,
      });
    }
    return asGeneratedAssetJob(finished);
  } catch (err) {
    if (budgetReserved) {
      try {
        if (modelCostRecorded) {
          const billingUserId = currentRunUserId();
          const billableUsd = Math.max(0, billableUsdSoFar() - billableBeforeUsd);
          if (billingUserId) {
            await recordOrchestratorBudgetBilling({
              projectId,
              reservationKey: budgetReservationKey,
              billingUserId,
              billableUsd,
            });
          }
          await settleOrchestratorBudget({
            projectId,
            reservationKey: budgetReservationKey,
            actualUsd: estimatedCostUsd,
            billingUserId: billingUserId ?? undefined,
            billableUsd,
          });
        } else {
          await releaseOrchestratorBudget({
            projectId,
            reservationKey: budgetReservationKey,
            reason: "pre_provider_failure",
          });
        }
      } catch (releaseError) {
        logger.error("generated_asset.budget_release_failed", {
          projectId,
          jobId: running.id,
          error: { message: releaseError instanceof Error ? releaseError.message : String(releaseError) },
        });
      }
    }
    const apiErr =
      err instanceof ApiError
        ? err
        : err instanceof Error && /^Run budget exceeded:/.test(err.message)
          ? new ApiError("budget_exceeded", err.message, {
              reason: "budget_exceeded",
              estimatedCostUsd,
              runId: parsed?.runId,
            })
        : err instanceof Error &&
            (/^Run not found:/.test(err.message) ||
              /^Run project mismatch:/.test(err.message))
          ? new ApiError("validation_failed", err.message, {
              fields: [
                {
                  path: "runId",
                  message: "runId must belong to the current project.",
                },
              ],
            })
        : new ApiError(
            "job_failed",
            err instanceof Error ? err.message : "Asset generation failed."
          );
    const failed = await completeProviderJobExecution({
      workspaceId: auth.workspaceId,
      projectId,
      jobId: running.id,
      claimToken: claim.claimToken,
      status: "failed",
      error: { code: apiErr.code, message: apiErr.message },
    });
    if (!failed) {
      return getJob(auth.workspaceId, projectId, running.id).then(asGeneratedAssetJob);
    }
    if (item) {
      await item.fail(toGenerationErrorSummary(apiErr));
    }
    return asGeneratedAssetJob(failed);
  } finally {
    clearInterval(claimHeartbeat);
  }
}

export interface GetGeneratedAssetJobArgs {
  auth: AuthContext;
  projectId: string;
  jobId: string;
}

export async function getGeneratedAssetJob(
  args: GetGeneratedAssetJobArgs
): Promise<ApiResult> {
  const { auth, projectId, jobId } = args;
  await getProject(auth.workspaceId, projectId); // throws not_found

  let loaded = await getJob(auth.workspaceId, projectId, jobId);
  // Polling is also the safe reconciliation trigger after a process crash.
  // It only examines an already-running provider claim; it never claims a
  // queued job or launches provider work from a read path.
  if (loaded.status === "running") {
    await claimProviderJobExecution({
      workspaceId: auth.workspaceId,
      projectId,
      jobId: loaded.id,
      staleBefore: new Date(Date.now() - PROVIDER_CLAIM_STALE_MS).toISOString(),
    });
    loaded = await getJob(auth.workspaceId, projectId, jobId);
  }
  const job: GeneratedAssetJob | null =
    loaded.type === "asset_generation" ? asGeneratedAssetJob(loaded) : null;
  if (
    !job ||
    job.workspaceId !== auth.workspaceId ||
    job.projectId !== projectId ||
    job.type !== "asset_generation"
  ) {
    throw new ApiError("not_found", `Generated-asset job not found: ${jobId}.`);
  }
  return { status: 200, body: { job } };
}
