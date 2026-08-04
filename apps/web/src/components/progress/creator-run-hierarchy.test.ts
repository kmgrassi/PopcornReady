import assert from "node:assert/strict";
import test from "node:test";
import type { CreatorRunHierarchySession } from "../../lib/v1/generation-runs/status";
import {
  currentHierarchyRun,
  hierarchyCurrentLabel,
  hierarchyProgressLabel,
  sessionDescription,
  sessionOutputAssetIds,
  sessionProgress,
} from "./creator-run-hierarchy";

function session(
  overrides: Partial<CreatorRunHierarchySession> = {},
): CreatorRunHierarchySession {
  return {
    sessionId: "session-visuals",
    domain: "visuals",
    state: "active",
    runs: [
      {
        runId: "run-old",
        state: "complete",
        taskKind: "visual_production",
        report: { outcome: "done", outputAssetIds: ["asset-old"] },
        actions: [],
      },
      {
        runId: "run-current",
        state: "active",
        taskKind: "visual_production",
        report: null,
        actions: [
          {
            actionId: "action-1",
            label: "Generate shots",
            state: "active",
            outputAssetIds: ["asset-current", "asset-old"],
            jobs: [{ state: "active", completedItems: 3, totalItems: 6 }],
          },
        ],
      },
    ],
    ...overrides,
  };
}

test("summarizes the current specialist assignment without exposing raw ids", () => {
  const visuals = session();
  assert.equal(currentHierarchyRun(visuals)?.runId, "run-current");
  assert.deepEqual(sessionProgress(visuals), { completedItems: 3, totalItems: 6 });
  assert.deepEqual(sessionOutputAssetIds(visuals), ["asset-old", "asset-current"]);
  assert.equal(sessionDescription(visuals), "Creating the planned picture and motion.");
});

test("uses the recovered continuation instead of a failed predecessor", () => {
  const visuals = session();
  visuals.runs[0] = {
    ...visuals.runs[0]!,
    state: "blocked",
    report: { outcome: "blocked", outputAssetIds: [] },
    actions: [{
      actionId: "action-blocked",
      label: "Previous attempt",
      state: "blocked",
      outputAssetIds: [],
      jobs: [{ state: "blocked", completedItems: 1, totalItems: 6 }],
    }],
  };

  assert.equal(currentHierarchyRun(visuals)?.runId, "run-current");
  assert.deepEqual(sessionProgress(visuals), { completedItems: 3, totalItems: 6 });
});

test("maps every exceptional state into creator-facing copy", () => {
  assert.equal(sessionDescription(session({ state: "blocked" })), "The director is resolving a missing dependency.");
  assert.equal(sessionDescription(session({ state: "failed" })), "The director is reviewing what needs another pass.");
  assert.equal(sessionDescription(session({ state: "waiting" })), "Waiting for another part of the production.");
  assert.equal(sessionDescription(session({ state: "queued" })), "Ready when the current work allows it.");
  assert.equal(sessionDescription(session({ state: "complete" })), "All assigned work is complete.");
  assert.equal(sessionDescription(session({ state: "canceled" })), "This assignment was stopped.");
});

test("summarizes hierarchy completion and director-owned questions", () => {
  const hierarchy = {
    root: {
      runId: "root-1",
      state: "waiting" as const,
      message: "The creative director is resolving a specialist question.",
      needsDirectorDecision: true,
    },
    sessions: [session(), session({ sessionId: "session-audio", domain: "audio", state: "complete" })],
  };
  assert.equal(hierarchyProgressLabel(hierarchy), "1 of 2 specialist lanes complete");
  assert.equal(hierarchyCurrentLabel(hierarchy), "Director resolving a question");
});
