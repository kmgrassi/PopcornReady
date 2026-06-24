import { expect, test } from "@playwright/test";
import { expectNoAppCrash, mockLocalApi } from "../fixtures/local-api";

test("health endpoint returns JSON through the browser API path", async ({ page }) => {
  const response = await page.goto("/api/v1/health");
  expect(response?.ok()).toBe(true);
  expect(response?.headers()["content-type"]).toContain("application/json");

  const body = JSON.parse((await page.locator("body").textContent()) ?? "{}");
  expect(body).toMatchObject({ status: "ok", authMode: "local" });
});

test.describe("local auth and routing smoke", () => {
  test.beforeEach(async ({ page }) => {
    await mockLocalApi(page);
  });

  test("renders public auth routes", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("textbox", { name: "What should the video be about?" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create my 30-second video" }),
    ).toBeVisible();

    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    await page.goto("/signup");
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
  });

  test("opens protected local-mode surfaces without a hosted session", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Workspace controls" })).toBeVisible();
    await expect(page.getByText("Local mode").first()).toBeVisible();

    // The Studio route was retired (#491); the Library is the protected entry.
    await page.goto("/library/projects");
    await expect(page.getByRole("navigation", { name: "Library collections" })).toBeVisible();
  });

  test("keeps compatibility redirects and not-found route working", async ({ page }) => {
    await page.goto("/projects?source=smoke");
    await expect(page).toHaveURL(/\/library\/projects\?source=smoke$/);
    await expectNoAppCrash(page);

    await page.goto("/runs?status=running");
    await expect(page).toHaveURL(/\/library\/projects$/);
    await expectNoAppCrash(page);

    await page.goto("/assets");
    await expect(page).toHaveURL(/\/library\/assets$/);
    await expectNoAppCrash(page);

    await page.goto("/outputs");
    await expect(page).toHaveURL(/\/library\/projects$/);
    await expectNoAppCrash(page);

    await page.goto("/library");
    await expect(page).toHaveURL(/\/library\/projects$/);
    await expectNoAppCrash(page);

    await page.goto("/route-that-does-not-exist");
    await expect(page.getByText("Not found is migrating from Next to Vite SPA.")).toBeVisible();
  });
});
