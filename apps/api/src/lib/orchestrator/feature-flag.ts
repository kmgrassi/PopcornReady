const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);

/**
 * Temporary rollout fence for the creative-director root surface. The flat
 * all-tools root remains the default until the hierarchy cutover gate lands.
 */
export function isCreativeDirectorHierarchyEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return ENABLED_VALUES.has(
    String(env.POPCORN_CREATIVE_DIRECTOR_HIERARCHY || "").trim().toLowerCase()
  );
}

export function isOrchestratorToolLoopEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return ENABLED_VALUES.has(
    String(env.POPCORN_ORCHESTRATOR_TOOL_LOOP || "").trim().toLowerCase()
  );
}
