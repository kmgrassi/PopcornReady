import { DASHBOARD_SCHEMA_VERSION, type DashboardSummary } from "@popcorn/shared/v1/dashboard";
import {
  type GenerationRun,
  type GenerationRunStatus,
} from "@popcorn/shared/v1/types";
import type { AgentApiStore } from "../../agent-api/jobs";
import type { OrchestratorRun } from "./orchestrator-store";
import { paginate, type PageResult } from "./pagination";

export interface WorkspaceProjectRef {
  id: string;
  name: string;
}

// A generation run plus its owning project's name, for the cross-project
// Projects/Runs view. The wire shape is `GenerationRun & { projectName }`,
// matching the web client's WorkspaceGenerationRun.
export interface WorkspaceGenerationRunSummary extends GenerationRun {
  projectName: string;
}

export interface ListWorkspaceGenerationRunsDeps {
  listProjects: (workspaceId: string) => Promise<WorkspaceProjectRef[]>;
  listRunsForProject: (projectId: string) => Promise<OrchestratorRun[]>;
}

function mapOrchestratorSummary(run: OrchestratorRun): GenerationRun {
  const status = run.status === "waiting" ? "running" : run.status;
  return {
    runId: run.id,
    projectId: run.projectId,
    status,
    progressPercent: status === "queued" ? 0 : undefined,
    message:
      run.status === "waiting"
        ? "Generation is waiting for its next activity."
        : run.status === "running"
          ? "The orchestrator is running."
          : run.status === "succeeded"
            ? "Run ended. Open it to verify available outputs."
          : undefined,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    error: run.error
      ? {
          code: typeof run.error.kind === "string" ? run.error.kind : "orchestrator_error",
          message:
            typeof run.error.message === "string"
              ? run.error.message
              : "The orchestrator run failed.",
          retryable: run.error.recoverable === true,
        }
      : undefined,
  };
}

export async function listWorkspaceGenerationRunsWithDeps(
  workspaceId: string,
  opts: { status?: GenerationRunStatus; projectId?: string },
  limit: number,
  cursor: string | null,
  deps: ListWorkspaceGenerationRunsDeps
): Promise<PageResult<WorkspaceGenerationRunSummary>> {
  const projects = await deps.listProjects(workspaceId);
  const scoped = opts.projectId
    ? projects.filter((p) => p.id === opts.projectId)
    : projects;

  const perProject = await Promise.all(
    scoped.map(async (project) => {
      const runs = await deps.listRunsForProject(project.id);
      return runs.map((run) => ({
        ...mapOrchestratorSummary(run),
        projectName: project.name,
      }));
    })
  );

  let all = perProject.flat();
  if (opts.status) {
    all = all.filter((run) => run.status === opts.status);
  }
  // paginate() keys on { id, createdAt }; runs expose runId, so adapt the cursor
  // shape to the run's id without leaking an extra field into the wire output.
  const paged = paginate(
    all.map((run) => ({ ...run, id: run.runId })),
    limit,
    cursor
  );
  return {
    items: paged.items.map(({ id: _id, ...run }) => {
      void _id;
      return run;
    }),
    nextCursor: paged.nextCursor,
  };
}

// A rendered/export artifact plus its owning project's name, for the Outputs
// view (where Created Videos relocate). Maps the agent-api export Artifact onto
// the web client's WorkspaceOutput shape.
export interface WorkspaceOutputSummary {
  artifactId: string;
  projectId: string;
  projectName: string;
  timelineId?: string;
  url?: string;
  durationSec?: number;
  format?: string;
  createdAt: string;
}

export interface ListWorkspaceOutputsDeps {
  listProjects: (workspaceId: string) => Promise<WorkspaceProjectRef[]>;
  artifactStore: Pick<AgentApiStore, "listArtifactsForProject">;
}

export async function listWorkspaceOutputsWithDeps(
  workspaceId: string,
  opts: { projectId?: string },
  limit: number,
  cursor: string | null,
  deps: ListWorkspaceOutputsDeps
): Promise<PageResult<WorkspaceOutputSummary>> {
  const projects = await deps.listProjects(workspaceId);
  const scoped = opts.projectId
    ? projects.filter((p) => p.id === opts.projectId)
    : projects;

  const perProject = await Promise.all(
    scoped.map(async (project) => {
      const artifacts = await deps.artifactStore.listArtifactsForProject(
        project.id
      );
      return artifacts
        .filter((artifact) => artifact.status === "ready")
        .map<WorkspaceOutputSummary>((artifact) => ({
          artifactId: artifact.id,
          projectId: project.id,
          projectName: project.name,
          timelineId: artifact.timelineId,
          url: artifact.url ?? undefined,
          durationSec: artifact.durationSec,
          format: artifact.renderPlan?.format,
          createdAt: artifact.createdAt,
        }));
    })
  );

  const all = perProject.flat();
  // paginate() keys on { id, createdAt }; outputs expose artifactId.
  const paged = paginate(
    all.map((output) => ({ ...output, id: output.artifactId })),
    limit,
    cursor
  );
  return {
    items: paged.items.map(({ id: _id, ...output }) => {
      void _id;
      return output;
    }),
    nextCursor: paged.nextCursor,
  };
}

export interface GetWorkspaceDashboardSummaryDeps {
  listProjects: (workspaceId: string) => Promise<WorkspaceProjectRef[]>;
  listRunsForProject: (projectId: string) => Promise<OrchestratorRun[]>;
  artifactStore: Pick<AgentApiStore, "listArtifactsForProject">;
}

const DASHBOARD_RUN_STATUSES: GenerationRunStatus[] = ["queued", "running", "failed"];
const DASHBOARD_ACTIVE_RUN_LIMIT = 5;
const DASHBOARD_RECENT_OUTPUT_LIMIT = 6;

export async function getWorkspaceDashboardSummaryWithDeps(
  workspaceId: string,
  deps: GetWorkspaceDashboardSummaryDeps
): Promise<DashboardSummary> {
  const projects = await deps.listProjects(workspaceId);
  const listProjectsOnce = async () => projects;

  const [runsPage, outputsPage] = await Promise.all([
    listWorkspaceGenerationRunsWithDeps(
      workspaceId,
      {},
      Number.MAX_SAFE_INTEGER,
      null,
      { listProjects: listProjectsOnce, listRunsForProject: deps.listRunsForProject }
    ),
    listWorkspaceOutputsWithDeps(
      workspaceId,
      {},
      Number.MAX_SAFE_INTEGER,
      null,
      { listProjects: listProjectsOnce, artifactStore: deps.artifactStore }
    ),
  ]);

  const activeRuns = runsPage.items.filter((run) =>
    DASHBOARD_RUN_STATUSES.includes(run.status)
  );

  return {
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    counts: {
      projects: projects.length,
      activeRuns: activeRuns.length,
      outputs: outputsPage.items.length,
    },
    activeRuns: activeRuns.slice(0, DASHBOARD_ACTIVE_RUN_LIMIT).map((run) => ({
      runId: run.runId,
      projectId: run.projectId,
      projectName: run.projectName,
      status: run.status,
      reviewGate: run.reviewGate ?? null,
      currentStageType: run.currentStageType,
      progressPercent: run.progressPercent,
      updatedAt: run.updatedAt,
    })),
    recentOutputs: outputsPage.items
      .slice(0, DASHBOARD_RECENT_OUTPUT_LIMIT)
      .map((output) => ({
        artifactId: output.artifactId,
        projectId: output.projectId,
        projectName: output.projectName,
        timelineId: output.timelineId,
        url: output.url,
        durationSec: output.durationSec,
        format: output.format,
        createdAt: output.createdAt,
      })),
  };
}
