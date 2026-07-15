// Background worker for the async generate_storyboard tool. Generates one sketch
// tile per beat, persists each as an image asset (recording the plan as its
// input), writes the story spine scenes/beats/panels, marks the job terminal,
// and — completion-driven — resumes the parked orchestrator run. Workers run
// inline today (fire-and-forget from the tool's execute), so by the time the run
// resumes the assets are already written.

import { createDurableOrchestratorJobWriter, startDurableJobHeartbeat, type OrchestratorJobWriter } from "@/lib/orchestrator/job-gateway";
import { scheduleOrchestratorResume } from "@/lib/orchestrator/schedule-resume";
import type { AuthContext } from "@/lib/api/v1/auth";
import { addStoryboardTiles } from "@/lib/api/v1/store";
import { buildStoryboardForPlan } from "@/lib/api/v1/storyboards";
import { generateStoryboardTilesForPlan } from "@/lib/v1/generation/storyboard";
import type { ShotPlan } from "@popcorn/shared/types";

export interface StoryboardJobDeps {
  generateStoryboardTilesForPlan: typeof generateStoryboardTilesForPlan;
  addStoryboardTiles: typeof addStoryboardTiles;
  buildStoryboardForPlan: typeof buildStoryboardForPlan;
  jobs?: Pick<OrchestratorJobWriter, "setStep" | "succeed" | "fail"> & Partial<Pick<OrchestratorJobWriter, "reportProgress">>;
  enqueueOrchestratorDispatch?: (runId: string, workspaceId: string) => Promise<unknown>;
}

const defaultDeps: StoryboardJobDeps = {
  generateStoryboardTilesForPlan,
  addStoryboardTiles,
  buildStoryboardForPlan,
};

function localAuth(workspaceId: string): AuthContext {
  return {
    mode: "local",
    actor: { id: "orchestrator", type: "local" },
    workspaceId,
    isLocal: true,
  };
}

async function resume(
  deps: StoryboardJobDeps,
  runId: string,
  workspaceId: string
): Promise<void> {
  await scheduleOrchestratorResume({ runId, workspaceId, enqueue: deps.enqueueOrchestratorDispatch });
}

export interface StoryboardJobInput {
  jobId: string;
  workspaceId: string;
  projectId: string;
  orchestratorRunId?: string;
  plan: ShotPlan;
  planAssetId: string;
  planContentHash: string;
  createdByActionId?: string;
}

export async function runStoryboardJob(
  input: StoryboardJobInput,
  deps: Partial<StoryboardJobDeps> = {}
): Promise<void> {
  const d = { ...defaultDeps, ...deps };
  const jobs = d.jobs ?? createDurableOrchestratorJobWriter(input.workspaceId, input.projectId);
  const stopHeartbeat = startDurableJobHeartbeat(jobs, input.jobId);
  try {
    await jobs.setStep(input.jobId, "generating_assets");

    const tiles = await d.generateStoryboardTilesForPlan({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      plan: input.plan,
    });

    const persisted = await d.addStoryboardTiles({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      planAssetId: input.planAssetId,
      planContentHash: input.planContentHash,
      tiles,
      ...(input.createdByActionId ? { createdByActionId: input.createdByActionId } : {}),
    });

    const tileAssetByBeatId = new Map(persisted.map((tile) => [tile.beatId, tile.assetId]));
    const { storyboardId } = await d.buildStoryboardForPlan({
      auth: localAuth(input.workspaceId),
      projectId: input.projectId,
      planAssetId: input.planAssetId,
      plan: input.plan,
      tileAssetByBeatId,
    });

    await jobs.succeed(input.jobId, {
      assetIds: persisted.map((tile) => tile.assetId),
      storyboardId,
    });
  } catch (err) {
    await jobs.fail(input.jobId, {
      code: "job_failed",
      message: err instanceof Error ? err.message : String(err),
      requestId: "",
    });
  } finally {
    stopHeartbeat();
    // Completion-driven resume; best-effort so a synthetic/absent run (e.g. the
    // test harness, which uses an in-memory run id) can't crash the worker.
    if (input.orchestratorRunId) {
      try {
        await resume(d, input.orchestratorRunId, input.workspaceId);
      } catch {
        // ignore — a sweeper reclaims any run left parked.
      }
    }
  }
}
