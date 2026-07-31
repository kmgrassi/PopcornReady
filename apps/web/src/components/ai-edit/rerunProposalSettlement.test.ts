import assert from "node:assert/strict";
import test from "node:test";

import { settledExecutionTarget } from "./rerunProposalSettlement";

const priorTarget = { scope: "tile", beatId: "beat-1", label: "Beat 1" } as const;
const restoredTarget = {
  scope: "tile",
  beatId: "beat-2",
  label: "Beat 2",
} as const;

test("restored execution settlement uses the current target, not a prior action target", () => {
  assert.equal(
    settledExecutionTarget(
      "restored-action",
      { actionId: "prior-action", target: priorTarget },
      restoredTarget
    ),
    restoredTarget
  );
});

test("locally started execution settlement retains its action-scoped target", () => {
  assert.equal(
    settledExecutionTarget(
      "local-action",
      { actionId: "local-action", target: priorTarget },
      restoredTarget
    ),
    priorTarget
  );
});
