import assert from "node:assert/strict";
import test from "node:test";

import type { DashboardSummary } from "@popcorn/shared/v1/dashboard";
import { deriveNextAction } from "./nextAction";

function summary(overrides: Partial<DashboardSummary>): DashboardSummary {
  return {
    schemaVersion: "dashboard.v1",
    counts: { projects: 1, activeRuns: 0, outputs: 0 },
    activeRuns: [],
    recentOutputs: [],
    ...overrides,
  };
}

test("deriveNextAction sends failed dashboard runs to recovery", () => {
  const action = deriveNextAction(
    summary({
      counts: { projects: 1, activeRuns: 1, outputs: 0 },
      activeRuns: [
        {
          runId: "run-1",
          projectId: "project-1",
          projectName: "Cookie launch",
          status: "failed",
          currentStageType: "export",
          progressPercent: 50,
          updatedAt: "2026-07-09T15:00:00.000Z",
        },
      ],
    }),
  );

  assert.equal(action.type, "failed_run");
  assert.equal(action.title, "A generation needs attention");
  assert.equal(action.ctaLabel, "Review failure");
  assert.equal(action.to, "/projects/project-1/runs/run-1");
  assert.match(action.body, /Cookie launch stopped at Export/);
});

test("deriveNextAction does not call unknown failed stages preparing", () => {
  const action = deriveNextAction(
    summary({
      counts: { projects: 1, activeRuns: 1, outputs: 0 },
      activeRuns: [
        {
          runId: "run-1",
          projectId: "project-1",
          projectName: "Cookie launch",
          status: "failed",
          progressPercent: 50,
          updatedAt: "2026-07-09T15:00:00.000Z",
        },
      ],
    }),
  );

  assert.equal(action.type, "failed_run");
  assert.equal(
    action.body,
    "Cookie launch stopped. Open the run to see what failed and retry from the failed stage.",
  );
});

test("deriveNextAction does not invent a percentage for active work", () => {
  const action = deriveNextAction(
    summary({
      counts: { projects: 1, activeRuns: 1, outputs: 0 },
      activeRuns: [
        {
          runId: "run-active",
          projectId: "project-1",
          projectName: "Cookie launch",
          status: "running",
          currentStageType: "asset_generation",
          updatedAt: "2026-07-09T15:00:00.000Z",
        },
      ],
    }),
  );

  assert.equal(action.type, "watch_run");
  assert.doesNotMatch(action.body, /0%|50%/);
  assert.match(action.body, /Progress will update/);
});
