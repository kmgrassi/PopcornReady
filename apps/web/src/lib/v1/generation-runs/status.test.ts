import assert from "node:assert/strict";
import test from "node:test";
import { isCreatorRunHierarchy, isGenerationRunDetail } from "./status";

const hierarchy = {
  root: {
    runId: "root-1",
    state: "active",
    message: "The creative director is guiding this production.",
    needsDirectorDecision: false,
  },
  sessions: [
    {
      sessionId: "session-1",
      domain: "visuals",
      state: "active",
      runs: [
        {
          runId: "run-1",
          state: "active",
          taskKind: "visual_production",
          report: null,
          actions: [
            {
              actionId: "action-1",
              label: "Generate shots",
              state: "active",
              outputAssetIds: [],
              jobs: [{ state: "active", completedItems: 1, totalItems: 3 }],
            },
          ],
        },
      ],
    },
  ],
};

test("validates the complete creator-safe hierarchy contract", () => {
  assert.equal(isCreatorRunHierarchy(hierarchy), true);
  assert.equal(
    isGenerationRunDetail({
      run: { runId: "root-1", projectId: "project-1", status: "running" },
      stages: [],
      stageItems: [],
      hierarchy,
    }),
    true,
  );
});

test("rejects malformed hierarchy state instead of trusting the generic response cast", () => {
  assert.equal(
    isCreatorRunHierarchy({
      ...hierarchy,
      sessions: [{ ...hierarchy.sessions[0], state: "mystery" }],
    }),
    false,
  );
  assert.equal(
    isGenerationRunDetail({
      run: { runId: "root-1", projectId: "project-1", status: "running" },
      stages: [],
      stageItems: [],
      hierarchy: { root: hierarchy.root, sessions: "not-an-array" },
    }),
    false,
  );
});

test("rejects incoherent hierarchy job progress", () => {
  const withProgress = (completedItems: number, totalItems: number) => ({
    ...hierarchy,
    sessions: [{
      ...hierarchy.sessions[0],
      runs: [{
        ...hierarchy.sessions[0]!.runs[0],
        actions: [{
          ...hierarchy.sessions[0]!.runs[0]!.actions[0],
          jobs: [{ state: "active", completedItems, totalItems }],
        }],
      }],
    }],
  });

  assert.equal(isCreatorRunHierarchy(withProgress(-1, 3)), false);
  assert.equal(isCreatorRunHierarchy(withProgress(1.5, 3)), false);
  assert.equal(isCreatorRunHierarchy(withProgress(4, 3)), false);
});
