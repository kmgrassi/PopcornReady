const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

export interface CreativeDirectorHierarchyRollout {
  enabled: boolean;
  fallbackUntil: string | null;
}

/**
 * Root ownership is no longer environment-selectable. Keep this health-shaped
 * projection until PR 7 removes the historical rollout surface.
 */
export function creativeDirectorHierarchyRollout(
  _env: NodeJS.ProcessEnv = process.env,
  _now: Date = new Date()
): CreativeDirectorHierarchyRollout {
  return { enabled: true, fallbackUntil: null };
}

export function isCreativeDirectorHierarchyEnabled(
  _env: NodeJS.ProcessEnv = process.env
): boolean {
  return true;
}

export function isOrchestratorToolLoopEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return ENABLED_VALUES.has(
    String(env.POPCORN_ORCHESTRATOR_TOOL_LOOP || "").trim().toLowerCase()
  );
}
