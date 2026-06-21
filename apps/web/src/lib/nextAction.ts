import type {
  DashboardActiveRunSummary,
  DashboardRecentOutput,
  DashboardSummary,
} from "@popcorn/shared/v1/dashboard";
import type { RunReviewGate } from "@popcorn/shared/v1/types";
import { isRunActive } from "./v1/generation-runs/status";

export interface DraftSummary {
  draftId: string;
  goalExcerpt: string;
  step: number;
  totalSteps: number;
  updatedAt: string;
}

type GatedRun = DashboardActiveRunSummary & {
  reviewGate?: RunReviewGate | null;
};

export type NextAction =
  | {
      type: "review_gate";
      run: GatedRun;
      title: string;
      body: string;
      ctaLabel: string;
      to: string;
    }
  | {
      type: "watch_run";
      run: DashboardActiveRunSummary;
      title: string;
      body: string;
      ctaLabel: string;
      to: string;
    }
  | {
      type: "review_cut";
      output: DashboardRecentOutput;
      title: string;
      body: string;
      ctaLabel: string;
      to: string;
    }
  | {
      type: "resume_draft";
      draft: DraftSummary;
      title: string;
      body: string;
      ctaLabel: string;
      to: string;
    }
  | {
      type: "start";
      title: string;
      body: string;
      ctaLabel: string;
      to: string;
    }
  | {
      type: "new";
      title: string;
      body: string;
      ctaLabel: string;
      to: string;
    };

export function deriveNextAction(
  pulse: DashboardSummary | null | undefined,
  drafts: readonly DraftSummary[] = [],
): NextAction {
  const gatedRun = pulse?.activeRuns.find(
    (run): run is GatedRun => Boolean((run as GatedRun).reviewGate),
  );
  if (gatedRun) {
    return {
      type: "review_gate",
      run: gatedRun,
      title: "Your cut is waiting for review",
      body: `${gatedRun.projectName} is paused at ${formatStage(gatedRun.currentStageType)} until you approve the next step.`,
      ctaLabel: "Review gate",
      to: runPath(gatedRun),
    };
  }

  const activeRun = pulse?.activeRuns.find((run) => isRunActive(run.status));
  if (activeRun) {
    return {
      type: "watch_run",
      run: activeRun,
      title: "Watch this generation",
      body: `${activeRun.projectName} is ${formatStage(activeRun.currentStageType).toLowerCase()} at ${activeRun.progressPercent ?? 0}% complete.`,
      ctaLabel: "Open progress",
      to: runPath(activeRun),
    };
  }

  const recentOutput = pulse?.recentOutputs[0];
  if (recentOutput) {
    return {
      type: "review_cut",
      output: recentOutput,
      title: "Review your rough cut",
      body: `${recentOutput.projectName} finished recently. Check the exported cut and decide what changes next.`,
      ctaLabel: "Review output",
      to: outputPath(recentOutput),
    };
  }

  const draft = drafts[0];
  if (draft) {
    return {
      type: "resume_draft",
      draft,
      title: `Draft unavailable - ${draft.goalExcerpt}`,
      body: "Studio drafts are no longer available. Open the project library to continue from saved projects.",
      ctaLabel: "View projects",
      to: "/library/projects",
    };
  }

  if (!pulse || pulse.counts.projects === 0) {
    return {
      type: "start",
      title: "No projects yet",
      body: "Project creation is being reworked. Your project library will show saved work as it becomes available.",
      ctaLabel: "View projects",
      to: "/library/projects",
    };
  }

  return {
    type: "new",
    title: "Workspace is up to date",
    body: "No workspace item needs attention right now. Browse saved projects, runs, assets, and outputs.",
    ctaLabel: "View projects",
    to: "/library/projects",
  };
}

export function runPath(run: Pick<DashboardActiveRunSummary, "projectId" | "runId">) {
  return `/projects/${encodeURIComponent(run.projectId)}/runs/${encodeURIComponent(run.runId)}`;
}

function outputPath(output: DashboardRecentOutput) {
  return `/projects/${encodeURIComponent(output.projectId)}#outputs`;
}

export function formatStage(stage: DashboardActiveRunSummary["currentStageType"]) {
  if (!stage) return "Preparing";
  return stage
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}
