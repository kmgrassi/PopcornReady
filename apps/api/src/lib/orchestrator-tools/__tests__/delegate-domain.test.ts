import assert from "node:assert/strict";
import test from "node:test";

import { buildDelegatedTask, createDelegateAudioTool, createDelegateVisualsTool } from "../delegate-domain";

test("Visuals delegation requires explicit bounded terminal output kinds", () => {
  const tool = createDelegateVisualsTool();
  assert.throws(() => tool.parseInput({ objective: "Create an anchor plan." }), /requiredOutputKinds/);
  const parsed = tool.parseInput({ objective: "Create an anchor plan.", requiredOutputKinds: ["anchor"] });
  assert.equal(parsed.objective, "Create an anchor plan.");
  assert.deepEqual(parsed.requiredOutputKinds, ["anchor"]);
  assert.throws(
    () => createDelegateVisualsTool().parseInput({ objective: "Audio only.", requiredOutputKinds: [] }),
    /requiredOutputKinds/
  );
});

test("Audio delegation rejects Visuals-only terminal output kinds", () => {
  assert.throws(
    () => createDelegateAudioTool().parseInput({ objective: "Score the cut.", requiredOutputKinds: ["clip"] }),
    /does not accept requiredOutputKinds/
  );
});

test("Visuals delegation derives terminal requirements from the bounded output kinds", () => {
  const task = buildDelegatedTask({
    domain: "visuals",
    projectId: "project-1",
    rootRunId: "root-1",
    rootActionId: "action-1",
    creatorMessageId: "message-1",
    budgetUsd: 5,
    parsed: { objective: "Create the visual anchor plan.", requiredOutputKinds: ["anchor", "image"] },
  });
  assert.equal(task.domain, "visuals");
  assert.deepEqual(task.requiredOutputs, [
    { kind: "anchor", role: "visual_anchor", minimumCount: 1 },
    { kind: "image", role: "image", minimumCount: 1 },
  ]);
  assert.ok(!task.requiredOutputs.some((output) => output.kind === "clip"));
});
