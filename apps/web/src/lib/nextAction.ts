import type {
  DashboardActiveRunSummary,
  DashboardRecentOutput,
  DashboardSummary,
} from "@popcorn/shared/v1/dashboard";
import type { RunReviewGate } from "@popcorn/shared/v1/types";
import { isRunActive } from "./v1/generation-runs/status";

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
      type: "failed_run";
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
  pulse: Readonly<Partial<DashboardSummary>> | null | undefined,
): NextAction {
  const activeRuns = pulse?.activeRuns ?? [];
  const recentOutputs = pulse?.recentOutputs ?? [];
  const projectCount = pulse?.counts?.projects;

  const gatedRun = activeRuns.find(
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

  const activeRun = activeRuns.find((run) => isRunActive(run.status));
  if (activeRun) {
    return {
      type: "watch_run",
      run: activeRun,
      title: "Watch this generation",
      body:
        activeRun.progressPercent == null
          ? `${activeRun.projectName} is ${formatStage(activeRun.currentStageType).toLowerCase()}. Progress will update when measurable work completes.`
          : `${activeRun.projectName} is ${formatStage(activeRun.currentStageType).toLowerCase()} at ${activeRun.progressPercent}% complete.`,
      ctaLabel: "Open progress",
      to: runPath(activeRun),
    };
  }

  const failedRun = activeRuns.find((run) => run.status === "failed");
  if (failedRun) {
    return {
      type: "failed_run",
      run: failedRun,
      title: "A generation needs attention",
      body: failedRun.currentStageType
        ? `${failedRun.projectName} stopped at ${formatStage(failedRun.currentStageType)}. Open the run to see what failed and retry from the failed stage.`
        : `${failedRun.projectName} stopped. Open the run to see what failed and retry from the failed stage.`,
      ctaLabel: "Review failure",
      to: runPath(failedRun),
    };
  }

  const recentOutput = recentOutputs[0];
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

  if (!pulse || projectCount === 0) {
    return {
      type: "start",
      title: "Create your first video or asset",
      body: "Start a full video, or make an image, short video, or audio asset for a project.",
      ctaLabel: "Create",
      to: "/create",
    };
  }

  return {
    type: "new",
    title: "Create something new",
    body: "No workspace item needs attention right now. Start a full video or make one project asset when you are ready.",
    ctaLabel: "Create",
    to: "/create",
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
