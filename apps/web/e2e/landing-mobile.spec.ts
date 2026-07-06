import { expect, test } from "@playwright/test";
import { mockLocalApi } from "./fixtures/local-api";

test.describe("mobile landing @mobile", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await mockLocalApi(page);
  });

  test("keeps the landing page within the viewport and makes the primary CTA tappable", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("textbox", { name: "What should the video be about?" }),
    ).toBeVisible();

    const overflow = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(Math.max(overflow.body, overflow.document)).toBeLessThanOrEqual(
      overflow.viewport + 1,
    );

    const prompt = page.getByRole("textbox", {
      name: "What should the video be about?",
    });
    await prompt.fill(
      "A fast, warm 30-second launch video for a neighborhood bakery's midnight cookie menu.",
    );

    const primaryCta = page.getByRole("button", {
      name: "Create my 30-second video",
    });
    await expect(primaryCta).toBeEnabled();

    const ctaBox = await primaryCta.boundingBox();
    expect(ctaBox).not.toBeNull();
    expect(ctaBox?.x).toBeGreaterThanOrEqual(0);
    expect((ctaBox?.x ?? 0) + (ctaBox?.width ?? 0)).toBeLessThanOrEqual(390);
    expect(ctaBox?.height).toBeGreaterThanOrEqual(40);

    await primaryCta.tap({ trial: true });
  });
});
