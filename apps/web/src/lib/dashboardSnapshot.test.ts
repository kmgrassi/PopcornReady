import assert from "node:assert/strict";
import test from "node:test";
import type { DashboardSummaryResponse } from "@popcorn/shared/v1/dashboard";
import {
  dashboardSnapshotTestConstants,
  readDashboardSnapshot,
  writeDashboardSnapshot,
} from "./dashboardSnapshot";
import { queryKeys } from "./queryKeys";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

const actorId = "actor-a";
const workspaceId = "workspace-a";
const now = Date.parse("2026-08-07T12:00:00.000Z");

function response(projectName = "Cached project"): DashboardSummaryResponse {
  return {
    summary: {
      schemaVersion: "dashboard.v1",
      counts: { projects: 1, activeRuns: 1, outputs: 1 },
      activeRuns: [{
        runId: "run-a",
        projectId: "project-a",
        projectName,
        status: "running",
        updatedAt: "2026-08-07T11:59:00.000Z",
      }],
      recentOutputs: [{
        artifactId: "output-a",
        projectId: "project-a",
        projectName,
        url: "https://example.test/signed-output",
        thumbnailUrl: "https://example.test/signed-thumbnail",
        createdAt: "2026-08-07T11:58:00.000Z",
      }],
    },
  };
}

test("dashboard snapshots are actor/workspace scoped and omit signed URLs", () => {
  const storage = new MemoryStorage();
  writeDashboardSnapshot({ actorId, workspaceId, data: response(), now, storage });

  const snapshot = readDashboardSnapshot({ actorId, workspaceId, now, storage });
  assert.equal(snapshot?.savedAt, now);
  assert.equal(snapshot?.data.summary.activeRuns[0]?.projectName, "Cached project");
  assert.equal(snapshot?.data.summary.recentOutputs[0]?.url, undefined);
  assert.equal(snapshot?.data.summary.recentOutputs[0]?.thumbnailUrl, undefined);
  assert.equal(
    readDashboardSnapshot({ actorId: "actor-b", workspaceId, now, storage }),
    null,
  );
  assert.equal(
    readDashboardSnapshot({ actorId, workspaceId: "workspace-b", now, storage }),
    null,
  );
});

test("dashboard snapshots expire without extending their successful saved time", () => {
  const storage = new MemoryStorage();
  writeDashboardSnapshot({ actorId, workspaceId, data: response(), now, storage });

  const stillFresh = readDashboardSnapshot({
    actorId,
    workspaceId,
    now: now + dashboardSnapshotTestConstants.maxAgeMs,
    storage,
  });
  assert.equal(stillFresh?.savedAt, now);

  const expired = readDashboardSnapshot({
    actorId,
    workspaceId,
    now: now + dashboardSnapshotTestConstants.maxAgeMs + 1,
    storage,
  });
  assert.equal(expired, null);
});

test("dashboard snapshots fail closed for malformed and future records", () => {
  const storage = new MemoryStorage();
  const key = `${dashboardSnapshotTestConstants.storagePrefix}.${actorId}.${workspaceId}`;

  storage.setItem(key, "not-json");
  assert.equal(readDashboardSnapshot({ actorId, workspaceId, now, storage }), null);

  writeDashboardSnapshot({
    actorId,
    workspaceId,
    data: response(),
    now: now + 61_000,
    storage,
  });
  assert.equal(readDashboardSnapshot({ actorId, workspaceId, now, storage }), null);
});

test("dashboard snapshots reject embedded identity and invalid response shapes", () => {
  const key = `${dashboardSnapshotTestConstants.storagePrefix}.${actorId}.${workspaceId}`;
  const validRecord = {
    version: 1,
    actorId,
    workspaceId,
    savedAt: now,
    data: response(),
  };
  const invalidRecords = [
    { ...validRecord, actorId: "actor-b" },
    { ...validRecord, workspaceId: "workspace-b" },
    {
      ...validRecord,
      data: { summary: { ...validRecord.data.summary, schemaVersion: "dashboard.v2" } },
    },
    {
      ...validRecord,
      data: {
        summary: {
          ...validRecord.data.summary,
          counts: { projects: -1, activeRuns: 1, outputs: 1 },
        },
      },
    },
    {
      ...validRecord,
      data: {
        summary: {
          ...validRecord.data.summary,
          activeRuns: Array.from({ length: 51 }, () => validRecord.data.summary.activeRuns[0]),
        },
      },
    },
    {
      ...validRecord,
      data: {
        summary: {
          ...validRecord.data.summary,
          activeRuns: [{
            ...validRecord.data.summary.activeRuns[0],
            currentStageType: {},
          }],
        },
      },
    },
    {
      ...validRecord,
      data: {
        summary: {
          ...validRecord.data.summary,
          activeRuns: [{
            ...validRecord.data.summary.activeRuns[0],
            progressPercent: 500,
          }],
        },
      },
    },
    {
      ...validRecord,
      data: {
        summary: {
          ...validRecord.data.summary,
          recentOutputs: [{ projectId: "missing-required-fields" }],
        },
      },
    },
  ];

  for (const record of invalidRecords) {
    const storage = new MemoryStorage();
    storage.setItem(key, JSON.stringify(record));
    assert.equal(readDashboardSnapshot({ actorId, workspaceId, now, storage }), null);
  }
});

test("dashboard TanStack keys isolate actors in the same workspace", () => {
  assert.notDeepEqual(
    queryKeys.dashboardSummary("actor-a", workspaceId),
    queryKeys.dashboardSummary("actor-b", workspaceId),
  );
  assert.deepEqual(queryKeys.dashboardSummary("actor-a", workspaceId).slice(0, 2), [
    "dashboard",
    "summary",
  ]);
});
