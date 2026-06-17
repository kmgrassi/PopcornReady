import { agentApiStore, type AgentApiStore } from "@/lib/agent-api/jobs";
import type { AuthContext } from "@/lib/api/v1/auth";
import {
  generatePoster as realGeneratePoster,
  type GeneratePosterResult,
} from "@/lib/api/v1/poster-generation";

type PosterImageProvider = "openai" | "gemini" | "mock";

export interface GeneratePosterJobDeps {
  generatePoster: typeof realGeneratePoster;
  jobs: Pick<AgentApiStore, "setStep" | "succeed">;
  resumeOrchestratorRun?: (
    runId: string,
    deps: { workspaceId: string }
  ) => Promise<unknown>;
}

const defaultDeps: GeneratePosterJobDeps = {
  generatePoster: realGeneratePoster,
  jobs: agentApiStore,
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
  deps: GeneratePosterJobDeps,
  runId: string,
  workspaceId: string
): Promise<void> {
  const fn =
    deps.resumeOrchestratorRun ??
    (await import("@/lib/orchestrator/engine")).resumeOrchestratorRun;
  await fn(runId, { workspaceId });
}

export interface GeneratePosterJobInput {
  jobId: string;
  workspaceId: string;
  projectId: string;
  orchestratorRunId?: string;
  provider?: PosterImageProvider;
  force?: boolean;
}

export interface GeneratePosterJobSuccess {
  status: "succeeded";
  assetIds: string[];
  reused: boolean;
  selected: boolean;
  manuallyPinned: boolean;
}

export interface GeneratePosterJobSoftFailure {
  status: "failed";
  assetIds: string[];
  error: {
    code: "poster_generation_failed";
    message: string;
  };
}

function successPayload(result: GeneratePosterResult): GeneratePosterJobSuccess {
  return {
    status: "succeeded",
    assetIds: [result.poster.assetId],
    reused: result.poster.reused,
    selected: result.poster.selected,
    manuallyPinned: result.poster.manuallyPinned,
  };
}

export async function runGeneratePosterJob(
  input: GeneratePosterJobInput,
  deps: Partial<GeneratePosterJobDeps> = {}
): Promise<void> {
  const d = { ...defaultDeps, ...deps };
  try {
    await d.jobs.setStep(input.jobId, "generating_assets");
    const result = await d.generatePoster(localAuth(input.workspaceId), input.projectId, {
      ...(input.provider ? { provider: input.provider } : {}),
      ...(typeof input.force === "boolean" ? { force: input.force } : {}),
    });
    await d.jobs.succeed(input.jobId, successPayload(result));
  } catch (err) {
    await d.jobs.succeed(input.jobId, {
      status: "failed",
      assetIds: [],
      error: {
        code: "poster_generation_failed",
        message: err instanceof Error ? err.message : String(err),
      },
    } satisfies GeneratePosterJobSoftFailure);
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
