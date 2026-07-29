const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export interface CreativeDirectorHierarchyRollout {
  enabled: boolean;
  /** An active fallback is intentionally temporary and expires without a deploy. */
  fallbackUntil: string | null;
}

/**
 * New root runs use the creative-director hierarchy by default. A future-dated
 * emergency fallback can return new roots to flat without rewriting active
 * roots.
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
  const normalizedFallback = Number.isFinite(fallbackAt)
    ? new Date(fallbackAt).toISOString()
    : null;
  const calendarValid =
    normalizedFallback === fallbackUntil ||
    normalizedFallback?.replace(".000Z", "Z") === fallbackUntil;
  if (
    fallbackRequested &&
    calendarValid &&
    fallbackAt > now.getTime()
  ) {
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
