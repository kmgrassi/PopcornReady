import assert from "node:assert/strict";
import test from "node:test";

import type { AuthContext } from "@/lib/api/v1/auth";
import { createTestToolRegistry } from "./test-registry";
import {
  createRequestApprovalTool,
  parseRequestApprovalInput,
} from "../request-approval";

const auth: AuthContext = {
  mode: "local",
  actor: { id: "local_dev", type: "local" },
  workspaceId: "ws_1",
  isLocal: true,
};

function reachedGate() {
  return {
    id: "gate_1",
    orchestratorRunId: "run_1",
    stage: "export_video",
    status: "reached" as const,
    createdAt: "t0",
    updatedAt: "t0",
  };
}

test("request_approval parses the review step and preview artifacts", () => {
  assert.deepEqual(
    parseRequestApprovalInput({
      step: "export_video",
      previewArtifactIds: [" asset_1 "],
      note: " Review framing. ",
    }),
    {
      step: "export_video",
      previewArtifactIds: ["asset_1"],
      note: "Review framing.",
    }
  );
});

test("request_approval accepts audio fit as a reviewable step", () => {
  assert.equal(
    parseRequestApprovalInput({
      step: "fit_audio_to_picture",
      previewArtifactIds: ["critique_1"],
    }).step,
    "fit_audio_to_picture"
  );
});

test("request_approval rejects malformed preview artifact ids", () => {
  assert.throws(
    () => parseRequestApprovalInput({ step: "export_video", previewArtifactIds: 42 }),
    /previewArtifactIds must be an array/
  );
});

test("request_approval rejects a step that cannot rerun on rejection", () => {
  assert.throws(
    () => parseRequestApprovalInput({ step: "request_approval", previewArtifactIds: [] }),
    /step must name the tool being reviewed/
  );
});

test("default registry exposes request_approval as an approval tool", () => {
  const registry = createTestToolRegistry({
    requestApproval: {
      createReachedApprovalGate: async () => reachedGate(),
    },
  });
  const definition = registry.get("request_approval");

  assert.equal(definition.name, "request_approval");
  assert.equal(definition.execution, "approval");
  assert.equal(definition.inputSchema.type, "object");
  assert.equal(definition.outputSchema.type, "object");
});

test("request_approval creates a reached gate and parks on approval", async () => {
  let createdWith: { runId: string; stage: string } | undefined;
  const tool = createRequestApprovalTool({
    createReachedApprovalGate: async (input) => {
      createdWith = input;
      return reachedGate();
    },
  });

  const result = await tool.execute(
    { step: "export_video", previewArtifactIds: ["artifact_1"] },
    { auth, projectId: "proj_1", orchestratorRunId: "run_1" }
  );

  assert.deepEqual(createdWith, { runId: "run_1", stage: "export_video" });
  assert.equal(result.status, "waiting_for_approval");
  if (result.status === "waiting_for_approval") {
    assert.equal(result.gateId, "gate_1");
    assert.equal(result.resumesWhen, "approval_terminal");
    assert.deepEqual(result.previewArtifactIds, ["artifact_1"]);
  }
});

test("request_approval fails before writing without an orchestrator run id", async () => {
  let writes = 0;
  const tool = createRequestApprovalTool({
    createReachedApprovalGate: async () => {
      writes += 1;
      return reachedGate();
    },
  });

  const result = await tool.execute(
    { step: "export_video", previewArtifactIds: [] },
    { auth, projectId: "proj_1" }
  );

  assert.equal(result.status, "failed");
  if (result.status === "failed") {
    assert.equal(result.error.kind, "precondition_unmet");
    assert.equal(result.error.recoverable, false);
  }
  assert.equal(writes, 0);
});
