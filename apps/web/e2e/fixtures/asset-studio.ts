import { expect, type Page, type Route } from "@playwright/test";
import { now, workspaceId } from "./local-api";

export const project = {
  id: "project_asset_studio",
  schemaVersion: "project.v1",
  workspaceId,
  name: "Campaign stills",
  status: "active",
  visibility: "private",
  posterUrl:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 90'%3E%3Crect width='160' height='90' fill='%232a2440'/%3E%3C/svg%3E",
  createdAt: now,
  updatedAt: now,
};

export const longRunSummary =
  "Create a single-panel 2D RPG boss illustration in a clear 1990s pixel-art sprite-sheet style. Keep the composition focused, avoid glossy modern effects, emphasize a readable silhouette, and use a restrained brass, blue, and ember palette with deliberate one-pixel edges.";

export const recentProject = {
  ...project,
  id: "project_recent",
  name: "Midnight Drive",
  posterUrl: null,
  updatedAt: "2025-01-01T00:00:00.000Z",
};

export async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

export async function mockAssetStudioProject(page: Page) {
  await page.route("**/api/v1/projects?**", (route) => {
    expect(new URL(route.request().url()).searchParams.get("order")).toBe("updatedAt");
    return fulfillJson(route, {
      projects: [recentProject, project],
      pagination: { limit: 100, nextCursor: null },
    });
  });
}

export async function openProjectPicker(page: Page) {
  const trigger = page.getByRole("button", { name: /^Project / });
  await trigger.click();
  await expect(page.getByRole("searchbox", { name: "Find a project" })).toBeFocused();
  return trigger;
}

export async function expectCreationTypeTargets(page: Page) {
  const targets = await page.getByRole("radio").evaluateAll((inputs) =>
    inputs.map((input) => {
      const label = input.closest("label");
      if (!label) throw new Error("Creation type radio is missing its label");
      const box = label.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }),
  );

  expect(targets).toHaveLength(3);
  for (const target of targets) {
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
  }
}
