import assert from "node:assert/strict";
import test from "node:test";
import { paginate, paginateByUpdatedAt } from "../pagination";

test("updated pagination surfaces a recently changed older item", () => {
  const projects = Array.from({ length: 101 }, (_, index) => ({
    id: `project-${index.toString().padStart(3, "0")}`,
    createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
  }));
  projects[0] = {
    ...projects[0],
    updatedAt: new Date(Date.UTC(2027, 0, 1)).toISOString(),
  };

  const createdPage = paginate(projects, 100, null);
  assert.equal(
    createdPage.items.some((project) => project.id === projects[0].id),
    false
  );

  const updatedPage = paginateByUpdatedAt(projects, 4, null);
  assert.equal(updatedPage.items[0]?.id, projects[0].id);
});
