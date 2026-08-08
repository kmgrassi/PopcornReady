import type {
  RerunProposalV2,
  RerunTarget,
} from "@popcorn/shared/rerun-proposal";
import { ApiError } from "@/core/errors";
import { createAction, getProject } from "@/lib/api/v1/store";
import {
  getOrchestratorRun,
  listOrchestratorRunsForProject,
  type OrchestratorRun,
} from "@/lib/api/v1/orchestrator-store";
import {
  createRerunDecisionAdapter,
  finalizeRerunProposal,
  type RerunDecisionAdapter,
} from "./rerun-decision-adapter";
import {
  type RerunDecisionPacket,
} from "./rerun-decision-context";
import { loadRerunDecisionPacket } from "./rerun-decision-context-loader";

export interface RerunProposalV2ServiceDeps {
  authorizeProject: typeof getProject;
  getRun: typeof getOrchestratorRun;
  listRuns: typeof listOrchestratorRunsForProject;
  loadPacket: typeof loadRerunDecisionPacket;
  decide: RerunDecisionAdapter;
  createAction: typeof createAction;
  persistProposal?: (input: {
    projectId: string;
    rootRunId: string | null;
    source: "request_changes" | "autonomous_review";
    message: string;
    targets: RerunTarget[];
    proposal: RerunProposalV2;
    priorProposalActionId?: string;
    clarificationAnswer?: {
      answerFingerprint: string;
      optionId: string;
    };
  }) => Promise<{ id: string }>;
}

const defaultDeps: RerunProposalV2ServiceDeps = {
  authorizeProject: getProject,
  getRun: getOrchestratorRun,
  listRuns: listOrchestratorRunsForProject,
  loadPacket: loadRerunDecisionPacket,
  decide: createRerunDecisionAdapter(),
  createAction,
};

async function resolveRoot(input: {
  projectId: string;
  rootRunId?: string;
}, deps: RerunProposalV2ServiceDeps): Promise<OrchestratorRun | null> {
  if (input.rootRunId) {
    const run = await deps.getRun(input.rootRunId);
    if (
      run.projectId !== input.projectId ||
      run.agentRole !== "creative_director" ||
      !["queued", "running", "waiting"].includes(run.status)
    ) {
      throw new ApiError(
        "validation_failed",
        "rootRunId must identify a Creative Director root for the path project."
      );
    }
    return run;
  }
  const existing = (await deps.listRuns(input.projectId)).find((run) =>
    run.agentRole === "creative_director" &&
    (run.status === "queued" || run.status === "running" || run.status === "waiting")
  );
  if (existing) return existing;
  // Preview state is not transport state. PR 2 creates the executable root only
  // after approval; creating a queued row here would expose a never-dispatched
  // ghost run as active generation.
  return null;
}

export async function createRerunProposalV2(input: {
  workspaceId: string;
  projectId: string;
  source: "request_changes" | "autonomous_review";
  message: string;
  targets: RerunTarget[];
  rootRunId?: string;
  priorProposalActionId?: string;
  clarificationAnswer?: {
    answerFingerprint: string;
    optionId: string;
  };
}, overrides: Partial<RerunProposalV2ServiceDeps> = {}): Promise<{
  actionId: string;
  proposal: RerunProposalV2;
}> {
  const deps = { ...defaultDeps, ...overrides };
  // Service-role reads and the eventual action write are allowed only after the
  // authenticated workspace/project boundary succeeds.
  await deps.authorizeProject(input.workspaceId, input.projectId);
  const root = await resolveRoot({
    projectId: input.projectId,
    rootRunId: input.rootRunId,
  }, deps);
  let packet: RerunDecisionPacket;
  packet = await deps.loadPacket({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    ...(root ? { rootRunId: root.id } : {}),
    targets: input.targets,
    userIntent: input.message,
  });
  let proposal: RerunProposalV2;
  try {
    const decision = await deps.decide(packet);
    proposal = finalizeRerunProposal({
      packet,
      decision,
      source: input.source,
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === "validation_failed") {
      throw new ApiError(
        "model_output_invalid",
        "The Creative Director returned an invalid rerun decision.",
        { reason: error.message }
      );
    }
    throw error;
  }
  const action = deps.persistProposal
    ? await deps.persistProposal({
      projectId: input.projectId,
      rootRunId: root?.id ?? null,
      source: input.source,
      message: input.message,
      targets: input.targets,
      proposal,
      ...(input.priorProposalActionId
        ? { priorProposalActionId: input.priorProposalActionId }
        : {}),
      ...(input.clarificationAnswer
        ? { clarificationAnswer: input.clarificationAnswer }
        : {}),
    })
    : await deps.createAction({
      projectId: input.projectId,
      ...(root ? { orchestratorRunId: root.id } : {}),
      tool: "rerun_proposal",
      status: proposal.outcome === "no_op" ? "applied" : "proposed",
      inputAssetIds: proposal.inspectedAssetIds,
      rationale: proposal.rationale,
      params: {
        schemaVersion: "rerun_proposal_request.v2",
        source: input.source,
        message: input.message,
        targets: input.targets,
        ...(input.priorProposalActionId
          ? { priorProposalActionId: input.priorProposalActionId }
          : {}),
        ...(input.clarificationAnswer
          ? { clarificationAnswer: input.clarificationAnswer }
          : {}),
      },
      proposal: proposal as unknown as Record<string, unknown>,
    });
  return { actionId: action.id, proposal };
}
