import assert from "node:assert/strict";
import test from "node:test";
import type { DomainRunRecord, RootRunFamily } from "@/lib/api/v1/domain-session-store";
import { projectCreatorRunHierarchy } from "../session-run-projection";

function run(id: string, overrides: Partial<DomainRunRecord> = {}): DomainRunRecord {
  return {
    id, projectId: "project_1", status: "succeeded", inputSummary: "", agentRole: "visuals",
    agentSessionId: "session_visuals", sessionSequence: 1, taskKind: "visuals_production",
    taskParams: null, originKind: "creative_director", parentRunId: "root", rootActionId: "action_root",
    originActorId: null, originRequest: null, continuesRunId: null, pins: null, waitReason: null,
    completionRecipient: "creative_director", budgetUsd: null, spentUsd: 0,
    createdAt: "2026-07-29T00:00:00.000Z", updatedAt: "2026-07-29T00:00:00.000Z",
    startedAt: null, completedAt: null, supersededAt: null, ...overrides,
  };
}

function family(children: RootRunFamily["children"]): RootRunFamily {
  return { root: run("root", { agentRole: "creative_director", agentSessionId: null, originKind: null, parentRunId: null, rootActionId: null, completionRecipient: null }), children };
}

test("projects only current continuation leaves as unresolved director work", () => {
  const question = { schemaVersion: "DomainReport.v1" as const, outcome: { outcome: "question" as const, question: "Which cut?", targets: [], options: [], fingerprint: "secret" } };
  const done = { schemaVersion: "DomainReport.v1" as const, outcome: { outcome: "done" as const, outputs: [], changedSelections: [], acceptanceEvidence: [], sessionSummary: "secret" } };
  const hierarchy = projectCreatorRunHierarchy({
    family: family([
      { ...run("question"), reportActionId: "report_question", report: question },
      { ...run("successor", { continuesRunId: "question", sessionSequence: 2 }), reportActionId: "report_successor", report: done },
    ]), sessions: new Map(), actionsByRun: new Map(), jobs: new Map(),
  });
  assert.equal(hierarchy.root.needsDirectorDecision, false);
  assert.equal(hierarchy.sessions[0]?.state, "complete");
  assert.equal("actionId" in (hierarchy.sessions[0]?.runs[0]?.report ?? {}), false);
  assert.equal(JSON.stringify(hierarchy).includes("Which cut?"), false);
  assert.equal(JSON.stringify(hierarchy).includes("secret"), false);
});

test("keeps queued provider jobs distinct from waiting work", () => {
  const hierarchy = projectCreatorRunHierarchy({
    family: family([{ ...run("queued"), reportActionId: null, report: null }]), sessions: new Map(),
    actionsByRun: new Map([[
      "queued",
      [{ id: "action", tool: "generate_anchor", status: "running", params: {}, outputAssetIds: [], jobIds: ["job"], createdAt: "2026-07-29T00:00:00.000Z" }],
    ]]),
    jobs: new Map([["job", { id: "job", status: "queued", progress: {}, } as never]]),
  });
  assert.equal(hierarchy.sessions[0]?.runs[0]?.actions[0]?.jobs[0]?.state, "queued");
});
