import assert from "node:assert/strict";
import test from "node:test";

import { generatedAssetsRouter } from "../generated-assets";

function routeSignatures(): string[] {
  const stack = (generatedAssetsRouter as unknown as { stack: unknown[] }).stack;
  return stack.map((layer) => {
    const route = layer as {
      route?: {
        path: string;
        methods: Record<string, boolean>;
      };
    };
    const methods = Object.keys(route.route?.methods ?? {}).sort().join(",");
    return `${methods} ${route.route?.path ?? ""}`;
  });
}

test("generated-assets router exposes agent create and poll endpoints", () => {
  assert.deepEqual(routeSignatures(), [
    "post /projects/:projectId/generated-assets",
    "get /projects/:projectId/generated-assets/:jobId",
  ]);
});
