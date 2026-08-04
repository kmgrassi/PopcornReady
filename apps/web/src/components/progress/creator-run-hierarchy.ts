import type {
  CreatorRunHierarchy,
  CreatorRunHierarchyRun,
  CreatorRunHierarchySession,
  CreatorWorkState,
} from "../../lib/v1/generation-runs/status";

export const WORK_STATE_LABELS: Record<CreatorWorkState, string> = {
  queued: "Queued",
  active: "In progress",
  waiting: "Waiting",
  blocked: "Needs attention",
  failed: "Failed",
  complete: "Complete",
  canceled: "Canceled",
};

export const DOMAIN_LABELS: Record<CreatorRunHierarchySession["domain"], string> = {
  visuals: "Visuals",
  audio: "Audio",
};

export function currentHierarchyRun(
  session: CreatorRunHierarchySession,
): CreatorRunHierarchyRun | null {
  const candidates = [...session.runs].reverse();
  return candidates.find((run) => run.state === session.state) ?? candidates.at(0) ?? null;
}

export function sessionOutputAssetIds(session: CreatorRunHierarchySession): string[] {
  return [
    ...new Set(
      session.runs.flatMap((run) => [
        ...(run.report?.outputAssetIds ?? []),
        ...run.actions.flatMap((action) => action.outputAssetIds),
      ]),
    ),
  ];
}

export function sessionProgress(session: CreatorRunHierarchySession): {
  completedItems: number;
  totalItems: number;
} | null {
  const jobs = (currentHierarchyRun(session)?.actions ?? []).flatMap((action) => action.jobs);
  const measurable = jobs.filter(
    (job) => typeof job.completedItems === "number" && typeof job.totalItems === "number",
  );
  if (measurable.length === 0) return null;
  return measurable.reduce(
    (total, job) => ({
      completedItems: total.completedItems + (job.completedItems ?? 0),
      totalItems: total.totalItems + (job.totalItems ?? 0),
    }),
    { completedItems: 0, totalItems: 0 },
  );
}

export function sessionDescription(session: CreatorRunHierarchySession): string {
  if (session.state === "complete") return "All assigned work is complete.";
  if (session.state === "blocked") return "The director is resolving a missing dependency.";
  if (session.state === "failed") return "The director is reviewing what needs another pass.";
  if (session.state === "canceled") return "This assignment was stopped.";
  if (session.state === "queued") return "Ready when the current work allows it.";
  if (session.state === "waiting") return "Waiting for another part of the production.";
  return session.domain === "visuals"
    ? "Creating the planned picture and motion."
    : "Creating and fitting the production audio.";
}

export function hierarchyProgressLabel(hierarchy: CreatorRunHierarchy): string {
  if (hierarchy.sessions.length === 0) return "The director is planning the work";
  const complete = hierarchy.sessions.filter((session) => session.state === "complete").length;
  return `${complete} of ${hierarchy.sessions.length} specialist lanes complete`;
}

export function hierarchyCurrentLabel(hierarchy: CreatorRunHierarchy): string {
  if (hierarchy.root.needsDirectorDecision) return "Director resolving a question";
  if (hierarchy.sessions.length === 0) return "Director planning the work";
  const statePriority: CreatorWorkState[] = ["blocked", "failed", "active", "waiting", "queued"];
  const current = statePriority
    .flatMap((state) => hierarchy.sessions.filter((session) => session.state === state))
    .at(0);
  return current ? `${DOMAIN_LABELS[current.domain]} · ${WORK_STATE_LABELS[current.state]}` : "Finalizing production";
}
