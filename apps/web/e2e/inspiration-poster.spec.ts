import { expect, test, type Page, type Route } from "@playwright/test";
import { mockLocalApi } from "./fixtures/local-api";

const posterUrl =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 1200'%3E%3Crect width='800' height='1200' fill='%2314111c'/%3E%3Ctext x='80' y='590' fill='%23f5b62a' font-size='72' font-family='Arial'%3ENIGHT%20MARKET%3C/text%3E%3C/svg%3E";

function json(route: Route, body: unknown) {
  const origin = route.request().headers().origin;
  return route.fulfill({
    headers: {
      "access-control-allow-credentials": "true",
      "access-control-allow-origin": origin ?? "*",
      "content-type": "application/json",
      vary: "origin",
    },
    body: JSON.stringify(body),
  });
}

test("opens the generated story poster in the shared media viewer @mobile", async ({ page }) => {
  await mockLocalApi(page);

  await page.route("**/api/v1/inspiration/random", (route) =>
    json(route, {
      inspiration: inspirationFixture(),
    }),
  );
  await page.route("**/api/v1/inspiration/poster", (route) =>
    json(route, {
      movieTitle: "Night Market",
      poster: {
        status: "ready",
        url: posterUrl,
        assetId: "story-poster-1",
        prompt: "A lively night market thriller poster.",
      },
    }),
  );

  await page.goto("/inspiration");

  const posterButton = page.getByRole("button", {
    name: "View Night Market poster full screen",
  });
  await expect(posterButton).toBeVisible();
  await posterButton.click();

  const viewer = page.getByRole("dialog", { name: "Night Market" });
  await expect(viewer).toBeVisible();
  await expect(viewer.locator("img")).toHaveAttribute("src", posterUrl);

  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
});

function inspirationFixture() {
  const groups = ["setting", "antagonist", "stakes", "plot", "arc", "theme", "structure"] as const;
  const ingredients = Object.fromEntries(
    groups.map((group) => [group, { emoji: "✦", summary: `${group} summary` }]),
  );
  const elements = Object.fromEntries(
    groups.map((group) => [
      group,
      [
        {
          id: `${group}-1`,
          category: "plot_type",
          groupSlug: group,
          slug: `${group}-element`,
          name: `${group} element`,
          coreIdea: `${group} core idea`,
        },
      ],
    ]),
  );

  return {
    movieTitle: "Night Market",
    logline: "At closing time, a courier finds a dangerous secret.",
    premise: "A vibrant thriller unfolds after dark.",
    signature: "inspiration-signature",
    ingredients,
    elements,
  };
}
