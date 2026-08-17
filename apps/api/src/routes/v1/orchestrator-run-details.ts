import { ApiError } from "@/core/errors";
import type { HandlerCtx } from "@/lib/api/v1/handler";
import {
  getAsset,
  getJob,
  getProject,
  recordProjectActivity,
} from "@/lib/api/v1/store";
import {
  getAgentSession,
  getRootRunFamily,
} from "@/lib/api/v1/domain-session-store";
import {
  getOrchestratorRun,
  listRunActions,
  listRunGates,
  type RunActionSummary,
} from "@/lib/api/v1/orchestrator-store";
import { canViewOperatorDiagnostics } from "./orchestrator-run-helpers.js";
import {
  projectRunDetailFromParts,
  type GenerationRunDetail,
  type RunAssetPrompt,
} from "./orchestrator-run-projections.js";
import { projectCreatorRunHierarchy } from "./session-run-projection.js";
import type { Job } from "@popcorn/shared/v1/types";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function requireParam(params: Record<string, string | undefined>, name: string): string {
  const value = params[name];
  if (!value) throw new ApiError("validation_failed", `${name} is required.`);
  return value;
}

async function requireProjectAccess(workspaceId: string, projectId: string): Promise<void> {
  await getProject(workspaceId, projectId);
}

export type GenerationJobLoader = (
  workspaceId: string,
  projectId: string,
  jobId: string
) => Promise<Job>;

export async function loadRunJobsForProjection(input: {
  workspaceId: string;
  projectId: string;
  actions: RunActionSummary[];
  loadJob?: GenerationJobLoader;
}): Promise<Map<string, Job>> {
  const jobs = new Map<string, Job>();
  const jobIds = [...new Set(input.actions.flatMap((action) => action.jobIds))];
  const loadJob = input.loadJob ?? getJob;
  await Promise.all(
    jobIds.map(async (jobId) => {
      try {
        const job = await loadJob(input.workspaceId, input.projectId, jobId);
        jobs.set(jobId, job);
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "not_found") throw error;
        // Runs created before durable orchestrator jobs may reference a legacy
        // process-local id. Keep their detail pollable while omitting telemetry.
      }
    })
  );
  return jobs;
}

export async function loadRunAssetMetadata(
  workspaceId: string,
  projectId: string,
  actions: RunActionSummary[]
): Promise<Map<string, RunAssetPrompt>> {
  const outputAssetIds = [...new Set(actions.flatMap((action) => action.outputAssetIds))];
  const assetPrompts = new Map<string, RunAssetPrompt>();
  await Promise.all(
    outputAssetIds.map(async (assetId) => {
      try {
        const asset = await getAsset(workspaceId, projectId, assetId);
        const prompt = asset.provenance?.prompt?.trim();
        const description = asset.description?.trim();
        assetPrompts.set(assetId, {
          ...(prompt ? { prompt } : {}),
          ...(description ? { description } : {}),
          status: asset.status,
          kind: asset.kind,
          hasPlayableSource: Boolean(asset.remoteUrl || asset.storageKey),
        });
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "not_found") throw error;
      }
    })
  );
  return assetPrompts;
}

export async function assembleRunDetail(
  runId: string,
  workspaceId: string,
  projectId: string,
  includeOperatorDiagnostics = false
): Promise<GenerationRunDetail> {
  const [run, gates, actions] = await Promise.all([
    getOrchestratorRun(runId),
    listRunGates(runId),
    listRunActions(runId),
  ]);
  if (run.projectId !== projectId) {
    throw new ApiError("not_found", `Generation run not found: ${runId}`);
  }
  const [assetPrompts, jobs] = await Promise.all([
    loadRunAssetMetadata(workspaceId, projectId, actions),
    loadRunJobsForProjection({ workspaceId, projectId, actions }),
  ]);
  const detail = projectRunDetailFromParts(run, gates, actions, assetPrompts, {
    jobs,
    includeOperatorDiagnostics,
  });
  if (run.agentRole === "creative_director") {
    const family = await getRootRunFamily(run.id);
    const childActions = await Promise.all(
      family.children.map(async (child) => [child.id, await listRunActions(child.id)] as const)
    );
    const childJobs = await Promise.all(
      childActions.map(async ([childRunId, childRunActions]) => [
        childRunId,
        await loadRunJobsForProjection({ workspaceId, projectId, actions: childRunActions }),
      ] as const)
    );
    const sessionRequests = family.children.reduce<Array<readonly [string, "visuals" | "audio"]>>(
      (requests, child) => {
        if (child.agentSessionId && (child.agentRole === "visuals" || child.agentRole === "audio")) {
          requests.push([child.agentSessionId, child.agentRole]);
        }
        return requests;
      },
      []
    );
    const sessions = await Promise.all(
      [...new Map(sessionRequests).entries()].map(async ([sessionId, domain]) =>
        [sessionId, await getAgentSession(projectId, domain)] as const
      )
    );
    detail.hierarchy = projectCreatorRunHierarchy({
      family,
      sessions: new Map(
        sessions.filter(
          (entry): entry is [string, NonNullable<typeof entry[1]>] => Boolean(entry[1])
        )
      ),
      actionsByRun: new Map(childActions),
      jobs: new Map(childJobs.flatMap(([, loaded]) => [...loaded.entries()])),
    });
  }
  return detail;
}

export interface GenerationRunDetailRouteDeps {
  requireProjectAccess: typeof requireProjectAccess;
  recordProjectActivity: typeof recordProjectActivity;
  canViewOperatorDiagnostics: typeof canViewOperatorDiagnostics;
  assembleRunDetail: typeof assembleRunDetail;
}

export async function generationRunDetailRoute(
  ctx: Pick<HandlerCtx, "auth">,
  params: Record<string, string | undefined>,
  deps: Partial<GenerationRunDetailRouteDeps> = {}
) {
  const projectId = requireParam(params, "projectId");
  const runId = requireParam(params, "runId");
  await (deps.requireProjectAccess ?? requireProjectAccess)(ctx.auth.workspaceId, projectId);
  await (deps.recordProjectActivity ?? recordProjectActivity)(ctx.auth.workspaceId, projectId);
  const includeOperatorDiagnostics = await (
    deps.canViewOperatorDiagnostics ?? canViewOperatorDiagnostics
  )(ctx.auth);
  return {
    status: 200,
    body: await (deps.assembleRunDetail ?? assembleRunDetail)(
      runId,
      ctx.auth.workspaceId,
      projectId,
      includeOperatorDiagnostics
    ),
    headers: NO_STORE_HEADERS,
  };
}
