import { expect, test, type Page, type Route } from "@playwright/test";
import { mockLocalApi, now, workspaceId } from "./fixtures/local-api";

const project = {
  id: "creation-entry-project",
  schemaVersion: "project.v1",
  workspaceId,
  name: "Launch assets",
  status: "active",
  visibility: "private",
  createdAt: now,
  updatedAt: now,
};

async function json(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockProjects(page: Page, projects: unknown[]) {
  await page.unroute("**/api/v1/projects?**");
  await page.route("**/api/v1/projects?**", (route) =>
    json(route, {
      projects,
      pagination: { limit: 24, nextCursor: null },
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await mockLocalApi(page);
});

test("Dashboard, Activity, and the desktop shell share the asset Create route", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Create your first project asset" })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/create$/);

  await page.goto("/activity");
  await expect(page.getByRole("heading", { name: "No active generations" })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/create$/);

  await page.goto("/dashboard");
  const desktopCreate = page
    .getByRole("complementary")
    .getByRole("link", { name: "Create", exact: true });
  await expect(desktopCreate).not.toHaveAttribute("aria-current", "page");
  await desktopCreate.click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(desktopCreate).toHaveAttribute("aria-current", "page");

  await page.goto("/create/review");
  await expect(desktopCreate).toHaveAttribute("aria-current", "page");
  await page.goto("/projects/new");
  await expect(desktopCreate).not.toHaveAttribute("aria-current", "page");
});

test("Library routes both nonempty and empty project actions to Create", async ({ page }) => {
  await mockProjects(page, [project]);
  await page.goto("/library/projects");
  const populatedCreate = page.getByRole("main").getByRole("link", {
    name: "Create",
    exact: true,
  });
  await expect(populatedCreate).toHaveCount(1);
  await populatedCreate.click();
  await expect(page).toHaveURL(/\/create$/);

  await mockProjects(page, []);
  await page.goto("/library/projects");
  const emptyCreate = page.getByRole("main").getByRole("link", {
    name: "Create",
    exact: true,
  });
  await expect(emptyCreate).toHaveCount(2);
  await emptyCreate.last().click();
  await expect(page).toHaveURL(/\/create$/);
});

test("mobile Create is neutral, canonical, and distinct from full-video creation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");

  const mobileNav = page.getByRole("navigation", { name: "Primary mobile" });
  const create = mobileNav.getByRole("link", { name: "Create", exact: true });
  await create.click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(create).toHaveAttribute("aria-current", "page");

  const createStyle = await create.evaluate((element) => {
    const ctaProbe = document.createElement("span");
    ctaProbe.style.backgroundColor = "var(--cta)";
    document.body.append(ctaProbe);
    const styles = {
      background: getComputedStyle(element).backgroundColor,
      cta: getComputedStyle(ctaProbe).backgroundColor,
    };
    ctaProbe.remove();
    return styles;
  });
  expect(createStyle.background).not.toBe(createStyle.cta);

  await page.goto("/projects/new");
  await expect(page).toHaveURL(/\/projects\/new$/);
  await expect(create).not.toHaveAttribute("aria-current", "page");
  await expect(
    mobileNav.getByRole("link", { name: "Library", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});
