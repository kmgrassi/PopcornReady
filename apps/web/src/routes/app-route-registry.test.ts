import assert from "node:assert/strict";
import test from "node:test";
import {
  appRouteRegistry,
  appRoutesForBuild,
  devHarnessRoutes,
} from "./app-route-registry";

test("the route registry has unique mounted identities and path patterns", () => {
  const ids = appRouteRegistry.map((route) => route.id);
  const paths = appRouteRegistry.map((route) => route.path);
  const elements = appRouteRegistry.map((route) => route.element);
  const smokeFlows = appRouteRegistry.map((route) => route.routeSmokeFlowId);

  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(new Set(elements).size, elements.length);
  assert.equal(new Set(smokeFlows).size, smokeFlows.length);
  assert.equal(appRouteRegistry.filter((route) => route.kind === "index").length, 1);
  assert.equal(appRouteRegistry.filter((route) => route.kind === "catchall").length, 1);
});

test("production route truth excludes every development harness", () => {
  const production = appRoutesForBuild(false);
  const development = appRoutesForBuild(true);
  const devPaths = Object.values(devHarnessRoutes);

  assert.equal(development.length, appRouteRegistry.length);
  assert.equal(development.length - production.length, devPaths.length);
  assert.deepEqual(
    development
      .filter((route) => route.availability === "development")
      .map((route) => route.path),
    devPaths,
  );
  assert.equal(
    production.some((route) => route.path.startsWith("/dev/")),
    false,
  );
});

test("every production route has explicit smoke, access, fixture, and viewport truth", () => {
  for (const route of appRoutesForBuild(false)) {
    assert.match(route.routeSmokeFlowId, /^route\./);
    assert.ok(route.viewports.length > 0, `${route.id} has no viewport coverage`);
    assert.ok(route.fixture, `${route.id} has no fixture classification`);
    assert.ok(route.access, `${route.id} has no access classification`);
    assert.ok(Array.isArray(route.allowedNavigationWrites));
    if (route.kind === "redirect" || route.kind === "catchall") {
      assert.deepEqual(
        route.featureFlowIds,
        [],
        `${route.id} must not treat route smoke as feature coverage`,
      );
    }
    if (route.access === "admin") {
      assert.equal(route.fixture, "admin-user");
    }
  }
});

test("dynamic, index, catchall, and layout semantics remain explicit", () => {
  for (const route of appRouteRegistry) {
    if (route.kind === "dynamic") assert.match(route.path, /:/);
    if (route.kind === "index") {
      assert.equal(route.path, "/");
      assert.equal(route.layout, "public");
    }
    if (route.kind === "catchall") {
      assert.equal(route.path, "*");
      assert.equal(route.layout, "fallback");
    }
    if (route.access !== "public") {
      assert.equal(route.layout, "authenticated");
    }
  }
});

