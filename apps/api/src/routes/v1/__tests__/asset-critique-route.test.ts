import assert from "node:assert/strict";
import test from "node:test";
import { assetsRouter } from "../assets";

test("assets router exposes the exact asset critique endpoint", () => {
  const routes = (assetsRouter as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> })
    .stack.flatMap((layer) => layer.route ? [layer.route] : []);
  assert.equal(
    routes.some((route) =>
      route.path === "/projects/:projectId/assets/:assetId/critique" && route.methods.post
    ),
    true,
  );
});
