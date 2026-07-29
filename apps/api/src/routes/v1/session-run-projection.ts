import type { AgentDomain, DomainReportV1 } from "@popcorn/shared/domain-agent-contract";
import type { Job } from "@popcorn/shared/v1/types";
import type {
  AgentSessionRecord,
  DomainRunRecord,
  RootRunFamily,
} from "@/lib/api/v1/domain-session-store";
import type { RunActionSummary } from "@/lib/api/v1/orchestrator-store";
import { toolLabel } from "./orchestrator-run-projections.js";

export type CreatorWorkState = "queued" | "active" | "waiting" | "blocked" | "failed" | "complete" | "canceled";

export interface CreatorRunHierarchy {
  root: { runId: string; state: CreatorWorkState; message: string; needsDirectorDecision: boolean };
  sessions: Array<{
    sessionId: string;
    domain: AgentDomain;
    state: CreatorWorkState;
    runs: Array<{
      runId: string;
      state: CreatorWorkState;
      taskKind: string | null;
      report: { actionId: string; outcome: "done" | "blocked" | "question"; outputAssetIds: string[] } | null;
      actions: Array<{ actionId: string; label: string; state: CreatorWorkState; outputAssetIds: string[]; jobs: Array<{ state: CreatorWorkState; completedItems?: number; totalItems?: number }> }>;
    }>;
  }>;
}

function stateFor(run: Pick<DomainRunRecord, "status" | "waitReason">, report: DomainReportV1 | null): CreatorWorkState {
  if (report?.outcome.outcome === "blocked") return "blocked";
  if (run.status === "queued") return "queued";
  if (run.status === "running") return "active";
  if (run.status === "waiting") return "waiting";
  if (run.status === "succeeded") return report?.outcome.outcome === "question" ? "waiting" : "complete";
  if (run.status === "canceled" || run.status === "superseded") return "canceled";
  return "failed";
}

function actionState(status: string): CreatorWorkState {
  if (status === "applied") return "complete";
  if (status === "running") return "active";
  if (status === "failed") return "failed";
  return "queued";
}

function jobState(status: Job["status"]): CreatorWorkState {
  if (status === "succeeded") return "complete";
  if (status === "running") return "active";
  if (status === "failed") return "failed";
  if (status === "canceled") return "canceled";
  return "waiting";
}

export function projectCreatorRunHierarchy(input: {
  family: RootRunFamily;
  sessions: ReadonlyMap<string, AgentSessionRecord>;
  actionsByRun: ReadonlyMap<string, RunActionSummary[]>;
  jobs: ReadonlyMap<string, Job>;
}): CreatorRunHierarchy {
  const needsDirectorDecision = input.family.children.some((child) => child.report?.outcome.outcome === "question");
  const grouped = new Map<string, typeof input.family.children>();
  for (const child of input.family.children) {
    if (!child.agentSessionId || (child.agentRole !== "visuals" && child.agentRole !== "audio")) continue;
    grouped.set(child.agentSessionId, [...(grouped.get(child.agentSessionId) ?? []), child]);
  }
  return {
    root: {
      runId: input.family.root.id,
      state: stateFor(input.family.root, null),
      message: needsDirectorDecision ? "The creative director is resolving a specialist question." : "The creative director is guiding this production.",
      needsDirectorDecision,
    },
    sessions: [...grouped.entries()].map(([sessionId, children]) => {
      const session = input.sessions.get(sessionId);
      const runs = children.map((child) => {
        const report = child.report
          ? { actionId: child.reportActionId!, outcome: child.report.outcome.outcome, outputAssetIds: child.report.outcome.outcome === "done" ? child.report.outcome.outputs.map((output) => output.assetId) : [] }
          : null;
        const actions = (input.actionsByRun.get(child.id) ?? []).filter((action) => action.tool !== "domain_report").map((action) => ({
          actionId: action.id, label: toolLabel(action.tool), state: actionState(action.status), outputAssetIds: action.outputAssetIds,
          jobs: action.jobIds.flatMap((jobId) => { const job = input.jobs.get(jobId); return job ? [{ state: jobState(job.status), ...(job.progress.completedItems !== undefined ? { completedItems: job.progress.completedItems } : {}), ...(job.progress.totalItems !== undefined ? { totalItems: job.progress.totalItems } : {}) }] : []; }),
        }));
        return { runId: child.id, state: stateFor(child, child.report), taskKind: child.taskKind, report, actions };
      });
      const state = runs.find((run) => run.state === "active")?.state ?? runs.find((run) => run.state === "waiting" || run.state === "blocked" || run.state === "failed")?.state ?? runs.find((run) => run.state === "queued")?.state ?? "complete";
      return { sessionId, domain: session?.domain ?? children[0]!.agentRole as AgentDomain, state, runs };
    }),
  };
}
