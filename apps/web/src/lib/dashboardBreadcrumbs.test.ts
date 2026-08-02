import assert from "node:assert/strict";
import test from "node:test";
import type { Location } from "react-router-dom";
import {
  getDashboardBreadcrumbParams,
  getDashboardBreadcrumbs,
} from "./dashboardBreadcrumbs";

function location(pathname: string): Location {
  return { pathname, search: "", hash: "", state: null, key: "test" };
}

test("creation routes stay under the Create breadcrumb", () => {
  assert.deepEqual(getDashboardBreadcrumbs(location("/create")), [
    { label: "Dashboard", to: "/dashboard" },
    { label: "Create" },
  ]);
  assert.deepEqual(getDashboardBreadcrumbs(location("/create/asset")), [
    { label: "Dashboard", to: "/dashboard" },
    { label: "Create", to: "/create" },
    { label: "Project asset" },
  ]);
  assert.deepEqual(getDashboardBreadcrumbs(location("/create/review")), [
    { label: "Dashboard", to: "/dashboard" },
    { label: "Create", to: "/create" },
    { label: "Review" },
  ]);
  assert.deepEqual(getDashboardBreadcrumbs(location("/projects/new")), [
    { label: "Dashboard", to: "/dashboard" },
    { label: "Create", to: "/create" },
    { label: "Full video" },
  ]);
  assert.deepEqual(getDashboardBreadcrumbs(location("/projects/new/")), [
    { label: "Dashboard", to: "/dashboard" },
    { label: "Create", to: "/create" },
    { label: "Full video" },
  ]);
  assert.deepEqual(getDashboardBreadcrumbParams(location("/projects/new/")), {});
});
