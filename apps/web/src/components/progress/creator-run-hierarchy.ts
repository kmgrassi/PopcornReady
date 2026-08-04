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

interface EmptyHierarchyCopy {
  current: string;
  progress: string;
  description: string;
  directorMessage?: string;
}

export function emptyHierarchyCopy(state: CreatorWorkState): EmptyHierarchyCopy {
  switch (state) {
    case "queued":
    case "active":
      return {
        current: "Director planning the work",
        progress: "The director is planning the work",
        description: "The director is deciding how to divide the work.",
      };
    case "waiting":
      return {
        current: "Director waiting to continue",
        progress: "Waiting before specialist work can begin",
        description: "The director is waiting before assigning specialist work.",
        directorMessage: "The creative director is waiting to continue.",
      };
    case "blocked":
      return {
        current: "Director needs attention",
        progress: "Specialist work has not started",
        description: "The director needs to resolve an issue before assigning specialist work.",
        directorMessage: "The creative director needs attention before work can continue.",
      };
    case "failed":
      return {
        current: "Production failed",
        progress: "No specialist work was delegated",
        description: "The production stopped before specialist work began.",
        directorMessage: "The creative director stopped before assigning specialist work.",
      };
    case "canceled":
      return {
        current: "Production canceled",
        progress: "No specialist work was delegated",
        description: "The production was canceled before specialist work began.",
        directorMessage: "The creative director stopped this production.",
      };
    case "complete":
      return {
        current: "Production complete",
        progress: "No specialist work was delegated",
        description: "The production completed without specialist assignments.",
        directorMessage: "The creative director completed this production.",
      };
  }
}

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
  if (hierarchy.sessions.length === 0) return emptyHierarchyCopy(hierarchy.root.state).progress;
  const complete = hierarchy.sessions.filter((session) => session.state === "complete").length;
  return `${complete} of ${hierarchy.sessions.length} specialist lanes complete`;
}

export function hierarchyCurrentLabel(hierarchy: CreatorRunHierarchy): string {
  if (hierarchy.root.needsDirectorDecision) return "Director resolving a question";
  if (hierarchy.sessions.length === 0) return emptyHierarchyCopy(hierarchy.root.state).current;
  const statePriority: CreatorWorkState[] = ["blocked", "failed", "active", "waiting", "queued"];
  const current = statePriority
    .flatMap((state) => hierarchy.sessions.filter((session) => session.state === state))
    .at(0);
  return current ? `${DOMAIN_LABELS[current.domain]} · ${WORK_STATE_LABELS[current.state]}` : "Finalizing production";
}
