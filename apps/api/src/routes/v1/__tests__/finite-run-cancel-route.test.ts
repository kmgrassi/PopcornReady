import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const route = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../orchestrator-runs.ts"),
  "utf8"
);

test("the public cancel route uses the causal finite-run cancellation transaction", () => {
  assert.match(route, /cancelOrchestratorRunFamily/);
  assert.match(
    route,
    /generation-runs\/:runId\/cancel[\s\S]*?cancelOrchestratorRunFamily\(\{ projectId, runId \}\)/
  );
});
