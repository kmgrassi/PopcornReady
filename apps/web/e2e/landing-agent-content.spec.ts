import { expect, test, type Page } from "@playwright/test";
import { mockLocalApi } from "./fixtures/local-api";

// The landing page must describe the shipped agent architecture: a creative
// director agent that delegates production to visuals and audio specialists
// (the same terminology the run-hierarchy UI uses), with provider copy that
// matches the models FAQ (Gemini Veo video, OpenAI/Ideogram images, ElevenLabs
// audio). These assertions fail if the director/specialist content or the new
// FAQ regresses to the old single-agent, Sora-era copy.

async function expectAgentCrewContent(page: Page) {
  const orchestratorHeading = page.getByRole("heading", {
    name: "A creative director runs a crew of specialists.",
  });
  await orchestratorHeading.scrollIntoViewIfNeeded();
  await expect(orchestratorHeading).toBeVisible();

  const generateStage = page.getByText(
    "The director hands each beat to specialist agents",
    { exact: false },
  );
  await generateStage.scrollIntoViewIfNeeded();
  await expect(generateStage).toBeVisible();
  await expect(generateStage).toContainText("Gemini Veo");
  await expect(generateStage).toContainText("ElevenLabs");

  const faqQuestion = page.getByRole("heading", {
    name: "How does the AI actually make the video?",
  });
  await faqQuestion.scrollIntoViewIfNeeded();
  await expect(faqQuestion).toBeVisible();
  const faqItem = page.locator("article", { has: faqQuestion });
  await expect(faqItem).toContainText("creative director agent");
  await expect(faqItem).toContainText("visuals agent");
  await expect(faqItem).toContainText("audio agent");

  // The retired provider mention must not resurface anywhere on the page.
  await expect(page.locator("body")).not.toContainText("Sora");
}

test.describe("landing agent architecture content", () => {
  test.beforeEach(async ({ page }) => {
    await mockLocalApi(page);
  });

  test("describes the creative director and specialist agents on desktop", async ({
    page,
  }) => {
    await page.goto("/");
    await expectAgentCrewContent(page);
  });
});

test.describe("landing agent architecture content @mobile", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await mockLocalApi(page);
  });

  test("keeps the director and specialist content reachable on mobile", async ({
    page,
  }) => {
    await page.goto("/");
    await expectAgentCrewContent(page);

    const overflow = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      document: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(Math.max(overflow.body, overflow.document)).toBeLessThanOrEqual(
      overflow.viewport + 1,
    );
  });
});
