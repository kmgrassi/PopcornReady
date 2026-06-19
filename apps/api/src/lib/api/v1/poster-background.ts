import type { AuthContext } from "./auth";
import { generatePoster } from "./poster-generation";

export interface PosterBackgroundOptions {
  provider?: string;
}

export interface PosterBackgroundDeps {
  generatePoster: typeof generatePoster;
  logError: typeof console.error;
}

const defaultDeps: PosterBackgroundDeps = {
  generatePoster,
  logError: console.error,
};

export function startPosterGenerationInBackground(
  auth: AuthContext,
  projectId: string,
  options: PosterBackgroundOptions = {},
  deps: Partial<PosterBackgroundDeps> = {}
): void {
  const resolved = { ...defaultDeps, ...deps };
  void resolved
    .generatePoster(auth, projectId, {
      provider: options.provider,
    })
    .catch((err) => {
      resolved.logError("poster generation failed", err);
    });
}
