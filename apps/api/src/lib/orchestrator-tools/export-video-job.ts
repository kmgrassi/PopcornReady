import { agentApiStore, type AgentApiStore } from "@/lib/agent-api/jobs";
import {
  runExportJob as realRunExportJob,
  type ExportOptions,
} from "@/lib/agent-api/workers";
import type { Artifact } from "@/lib/agent-api/types";
import { addExportVideoAsset as realAddExportVideoAsset } from "@/lib/api/v1/store";
import type { Project } from "@popcorn/shared/types";

export interface ExportVideoJobDeps {
  runExportJob: typeof realRunExportJob;
  saveArtifact: AgentApiStore["saveArtifact"];
  addExportVideoAsset: typeof realAddExportVideoAsset;
  jobs: Pick<AgentApiStore, "setStep" | "succeed" | "fail">;
  resumeOrchestratorRun?: (
    runId: string,
    deps: { workspaceId: string }
  ) => Promise<unknown>;
}

const defaultDeps: ExportVideoJobDeps = {
  runExportJob: realRunExportJob,
  saveArtifact: (artifact) => agentApiStore.saveArtifact(artifact),
  addExportVideoAsset: realAddExportVideoAsset,
  jobs: agentApiStore,
};

async function resume(
  deps: ExportVideoJobDeps,
  runId: string,
  workspaceId: string
): Promise<void> {
  const fn =
    deps.resumeOrchestratorRun ??
    (await import("@/lib/orchestrator/engine")).resumeOrchestratorRun;
  await fn(runId, { workspaceId });
}

export interface ExportVideoJobInput {
  jobId: string;
  workspaceId: string;
  projectId: string;
  orchestratorRunId?: string;
  timelineId: string;
  timelineContentHash: string;
  project: Project;
  options?: ExportOptions;
}

export async function runExportVideoJob(
  input: ExportVideoJobInput,
  deps: Partial<ExportVideoJobDeps> = {}
): Promise<void> {
  const d = { ...defaultDeps, ...deps };
  try {
    await d.jobs.setStep(input.jobId, "rendering_export");

    const { artifact } = d.runExportJob({
      project: input.project,
      timelineId: input.timelineId,
      options: input.options,
    });
    const savedArtifact = await d.saveArtifact(artifact);
    const asset = await d.addExportVideoAsset({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      artifact: savedArtifact,
      jobId: input.jobId,
      timelineId: input.timelineId,
      timelineContentHash: input.timelineContentHash,
      ...(input.orchestratorRunId ? { orchestratorRunId: input.orchestratorRunId } : {}),
    });

    await d.jobs.succeed(input.jobId, {
      artifactId: savedArtifact.id,
      assetIds: [asset.id],
      timelineId: input.timelineId,
      status: savedArtifact.status,
    });
  } catch (err) {
    await d.jobs.fail(input.jobId, {
      code: "job_failed",
      message: err instanceof Error ? err.message : String(err),
      requestId: "",
    });
  } finally {
    if (input.orchestratorRunId) {
      try {
        await resume(d, input.orchestratorRunId, input.workspaceId);
      } catch {
        // best-effort: durable run sweepers can resume a parked run later.
      }
    }
  }
}

export type { Artifact };
