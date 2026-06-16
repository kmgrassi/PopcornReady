import { expect, test } from "@playwright/test";
import { mockReviewExportApi } from "./fixtures/review-export-api";

test("review feedback, export polling, outputs listing, and watch playback share the generated timeline", async ({
  page,
}) => {
  const api = await mockReviewExportApi(page);

  await page.goto(`/studio?draft=${api.draftId}`);

  await expect(page.getByRole("heading", { name: "Your rough cut is ready" })).toBeVisible();
  await expect(page.getByText("Editable rough cut")).toBeVisible();
  await expect(page.getByText("coffee-reveal.mp4")).toBeVisible();

  await page.getByLabel("Feedback for regeneration").fill("Make the tasting note more explicit.");
  await page.getByRole("button", { name: "Regenerate with feedback" }).click();
  await expect(page.getByText("Feedback sent.")).toBeVisible();

  const revisionCall = api.calls.find(
    (call) =>
      call.method === "POST" &&
      call.pathname === `/api/v1/projects/${api.projectId}/timelines/${api.timelineId}/revisions`,
  );
  expect(revisionCall?.body).toEqual({
    message: "Make the tasting note more explicit.",
  });

  await page.getByRole("button", { name: "Continue to export" }).click();
  await expect(page.getByRole("heading", { name: "Export" })).toBeVisible();

  const exportAction = page
    .locator("section")
    .getByRole("button", { name: "Export", exact: true });
  await expect(exportAction).toBeEnabled();
  await exportAction.click();
  await expect(page.getByText("Export created")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open MP4" })).toBeVisible();

  const exportCall = api.calls.find(
    (call) =>
      call.method === "POST" &&
      call.pathname === `/api/v1/projects/${api.projectId}/timelines/${api.timelineId}/exports`,
  );
  expect(exportCall?.body).toEqual({
    format: "mp4",
    quality: "standard",
    durationPolicy: "match_longest_media",
    showCaptions: true,
  });

  await page.goto("/library/outputs");
  await expect(page.getByRole("heading", { name: "Outputs" })).toBeVisible();
  await expect(page.getByText("Coffee Reveal").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Watch" })).toHaveAttribute(
    "href",
    `/projects/${api.projectId}/watch`,
  );

  await page.getByRole("link", { name: "Watch" }).click();
  await expect(page).toHaveURL(`/projects/${api.projectId}/watch`);
  await expect(page.getByRole("heading", { name: "Coffee Reveal" })).toBeVisible();
  const video = page.locator("video");
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute("src", /data:video\/mp4/);
});
