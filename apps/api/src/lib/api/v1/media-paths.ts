import { AsyncLocalStorage } from "async_hooks";
import path from "path";

const localDirContext = new AsyncLocalStorage<string>();

// Resolved per call so tests can point POPCORN_READY_LOCAL_DIR at a temp directory.
export function localDir(): string {
  const contextualDir = localDirContext.getStore();
  if (contextualDir) return contextualDir;
  return process.env.POPCORN_READY_LOCAL_DIR || path.join(process.cwd(), ".local");
}

export function withLocalDir<T>(dir: string, fn: () => T): T {
  return localDirContext.run(dir, fn);
}

export function mediaUploadDir(workspaceId: string, projectId: string): string {
  return path.join(localDir(), "media", "uploads", workspaceId, projectId);
}

export function mediaGeneratedDir(workspaceId: string, projectId: string): string {
  return path.join(localDir(), "media", "generated", workspaceId, projectId);
}

export function mediaAnalysisDir(
  workspaceId: string,
  projectId: string,
  assetId: string
): string {
  return path.join(localDir(), "media", "analysis", workspaceId, projectId, assetId);
}
