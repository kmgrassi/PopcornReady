import assert from "node:assert/strict";
import test from "node:test";
import {
  isCreateNavigationPath,
  isLibraryNavigationPath,
} from "./dashboardNavigation";

test("Create owns its launcher, asset, review, and full-video routes", () => {
  assert.equal(isCreateNavigationPath("/create"), true);
  assert.equal(isCreateNavigationPath("/create/asset"), true);
  assert.equal(isCreateNavigationPath("/create/review"), true);
  assert.equal(isCreateNavigationPath("/projects/new"), true);
  assert.equal(isCreateNavigationPath("/projects/new/"), true);
  assert.equal(isCreateNavigationPath("/create/asset/"), true);
  assert.equal(isCreateNavigationPath("/projects/project-1"), false);
});

test("Library excludes full-video creation but owns ordinary project routes", () => {
  assert.equal(isLibraryNavigationPath("/projects/new"), false);
  assert.equal(isLibraryNavigationPath("/projects/new/"), false);
  assert.equal(isLibraryNavigationPath("/projects/project-1"), true);
  assert.equal(isLibraryNavigationPath("/library/projects"), true);
  assert.equal(isLibraryNavigationPath("/create"), false);
});
