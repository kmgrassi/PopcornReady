import type { AuthContext } from "./auth";
import { generatePoster } from "./poster-generation";
import { resumeOrchestratorRun } from "@/lib/orchestrator/engine";

export interface PosterBackgroundOptions {
  provider?: string;
  runId?: string;
}

export interface PosterBackgroundDeps {
  generatePoster: typeof generatePoster;
  resumeRun: typeof resumeOrchestratorRun;
  logError: typeof console.error;
}

const defaultDeps: PosterBackgroundDeps = {
  generatePoster,
  resumeRun: resumeOrchestratorRun,
  logError: console.error,
};

export function startPosterGenerationInBackground(
  auth: AuthContext,
  projectId: string,
  options: PosterBackgroundOptions = {},
  deps: Partial<PosterBackgroundDeps> = {}
): void {
  const resolved = { ...defaultDeps, ...deps };
  void (async () => {
    try {
      await resolved.generatePoster(auth, projectId, {
        provider: options.provider,
        runId: options.runId,
      });
    } catch (err) {
      resolved.logError("poster generation failed", err);
    } finally {
      if (options.runId) {
        resolved.resumeRun(options.runId, {
          workspaceId: auth.workspaceId,
          actorId: auth.actor.id,
          agentId: "orchestrator",
        }).catch((err) => {
          resolved.logError("orchestrator resume after poster failed", err);
        });
      }
    }
  })();
}
