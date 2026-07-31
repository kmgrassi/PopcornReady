import assert from "node:assert/strict";
import test from "node:test";
import { rerunProposalStorageKey } from "./rerunProposalStorage";

const projectTarget = { kind: "project", projectId: "project-1" } as const;

test("proposal persistence is scoped to its exact review surface", () => {
  const concept = rerunProposalStorageKey("project-1", projectTarget, {
    scope: "concept", runId: "run-1",
  });
  const brief = rerunProposalStorageKey("project-1", projectTarget, {
    scope: "brief", runId: "run-1",
  });
  const laterRun = rerunProposalStorageKey("project-1", projectTarget, {
    scope: "concept", runId: "run-2",
  });
  assert.notEqual(concept, brief);
  assert.notEqual(concept, laterRun);
  assert.equal(concept, rerunProposalStorageKey("project-1", projectTarget, {
    scope: "concept", runId: "run-1",
  }));
});
