import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const orchestratorRoutes = readFileSync(
  new URL("../orchestrator-runs.ts", import.meta.url),
  "utf8"
);
const timelineRoutes = readFileSync(
  new URL("../timelines.ts", import.meta.url),
  "utf8"
);

test("legacy run mutation routes are not mounted", () => {
  for (const retiredPath of [
    "/generation-runs/:runId/reject",
    "/generation-runs/:runId/restart-from",
    "/generation-runs/:runId/board-revisions",
    "/asset-revisions",
  ]) {
    assert.equal(orchestratorRoutes.includes(retiredPath), false, retiredPath);
  }
});

test("legacy timeline revision routes are not mounted", () => {
  assert.equal(timelineRoutes.includes("/timelines/:timelineId/revisions"), false);
});
