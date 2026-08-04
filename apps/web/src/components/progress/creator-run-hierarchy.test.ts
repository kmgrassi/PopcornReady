import assert from "node:assert/strict";
import test from "node:test";
import type { CreatorRunHierarchySession } from "../../lib/v1/generation-runs/status";
import {
  currentHierarchyRun,
  emptyHierarchyCopy,
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

test("prioritizes active work over an earlier queued lane", () => {
  const hierarchy = {
    root: {
      runId: "root-1",
      state: "active" as const,
      message: "The creative director is guiding this production.",
      needsDirectorDecision: false,
    },
    sessions: [
      session({ sessionId: "session-audio", domain: "audio", state: "queued" }),
      session(),
    ],
  };

  assert.equal(hierarchyCurrentLabel(hierarchy), "Visuals · In progress");
});

test("labels an empty hierarchy as planning", () => {
  const hierarchy = {
    root: {
      runId: "root-1",
      state: "active" as const,
      message: "The creative director is planning the work.",
      needsDirectorDecision: false,
    },
    sessions: [],
  };

  assert.equal(hierarchyCurrentLabel(hierarchy), "Director planning the work");
  assert.equal(hierarchyProgressLabel(hierarchy), "The director is planning the work");
});

test("uses root-state copy when an empty hierarchy is not actively planning", () => {
  const expected = {
    waiting: {
      current: "Director waiting to continue",
      progress: "Waiting before specialist work can begin",
      description: "The director is waiting before assigning specialist work.",
      directorMessage: "The creative director is waiting to continue.",
    },
    blocked: {
      current: "Director needs attention",
      progress: "Specialist work has not started",
      description: "The director needs to resolve an issue before assigning specialist work.",
      directorMessage: "The creative director needs attention before work can continue.",
    },
    failed: {
      current: "Production failed",
      progress: "No specialist work was delegated",
      description: "The production stopped before specialist work began.",
      directorMessage: "The creative director stopped before assigning specialist work.",
    },
    canceled: {
      current: "Production canceled",
      progress: "No specialist work was delegated",
      description: "The production was canceled before specialist work began.",
      directorMessage: "The creative director stopped this production.",
    },
    complete: {
      current: "Production complete",
      progress: "No specialist work was delegated",
      description: "The production completed without specialist assignments.",
      directorMessage: "The creative director completed this production.",
    },
  } as const;

  for (const [state, copy] of Object.entries(expected)) {
    const hierarchy = {
      root: {
        runId: "root-1",
        state: state as keyof typeof expected,
        message: "The creative director is guiding this production.",
        needsDirectorDecision: false,
      },
      sessions: [],
    };

    assert.deepEqual(emptyHierarchyCopy(hierarchy.root.state), copy);
    assert.equal(hierarchyCurrentLabel(hierarchy), copy.current);
    assert.equal(hierarchyProgressLabel(hierarchy), copy.progress);
  }
});
