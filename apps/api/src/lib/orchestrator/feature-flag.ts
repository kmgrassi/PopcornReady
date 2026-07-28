const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export interface CreativeDirectorHierarchyRollout {
  enabled: boolean;
  /** An active fallback is intentionally temporary and expires without a deploy. */
  fallbackUntil: string | null;
}

/**
 * PR 18 makes the creative-director root surface the default. Operators may
 * return to the flat root only by setting an explicit, future expiry; that
 * keeps an emergency rollback reversible and prevents it becoming a second
 * permanent production mode.
 */
export function creativeDirectorHierarchyRollout(
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date()
): CreativeDirectorHierarchyRollout {
  const fallbackRequested = ENABLED_VALUES.has(
    String(env.POPCORN_CREATIVE_DIRECTOR_FLAT_FALLBACK ?? "").trim().toLowerCase()
  );
  const fallbackUntil = String(env.POPCORN_CREATIVE_DIRECTOR_FLAT_FALLBACK_UNTIL ?? "").trim();
  const fallbackAt = UTC_TIMESTAMP.test(fallbackUntil) ? Date.parse(fallbackUntil) : Number.NaN;
  if (fallbackRequested && Number.isFinite(fallbackAt) && fallbackAt > now.getTime()) {
    return { enabled: false, fallbackUntil: new Date(fallbackAt).toISOString() };
  }
  return { enabled: true, fallbackUntil: null };
}

export function isCreativeDirectorHierarchyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return creativeDirectorHierarchyRollout(env).enabled;
}

export function isOrchestratorToolLoopEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return ENABLED_VALUES.has(
    String(env.POPCORN_ORCHESTRATOR_TOOL_LOOP || "").trim().toLowerCase()
  );
}
