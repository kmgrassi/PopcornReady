import assert from "node:assert/strict";
import test from "node:test";

import { createStoryboardEntrypointLock } from "../storyboard-entrypoint";
import type { withTransaction } from "../transactions";

test("storyboard entrypoint lock scopes one advisory transaction to the project", async () => {
  const queries: Array<{ text: string; values: unknown[] | undefined }> = [];
  let operationName = "";
  const transaction = (async <T>(
    operation: string,
    callback: (client: { query: (text: string, values?: unknown[]) => Promise<unknown> }) => Promise<T>
  ) => {
    operationName = operation;
    return callback({
      query: async (text, values) => {
        queries.push({ text, values });
        return {};
      },
    });
  }) as typeof withTransaction;
  const lock = createStoryboardEntrypointLock(transaction);

  const result = await lock("project_1", async () => "created");

  assert.equal(result, "created");
  assert.equal(operationName, "storyboard.entrypoint.find_or_create");
  assert.match(queries[0]?.text ?? "", /pg_advisory_xact_lock/);
  assert.deepEqual(queries[0]?.values, ["storyboard-entrypoint:project_1"]);
});
