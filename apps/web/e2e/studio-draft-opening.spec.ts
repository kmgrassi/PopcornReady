import { expect, test, type Route } from "@playwright/test";
import { mockLocalApi, now, workspaceId } from "./fixtures/local-api";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

const draftId = "slow-draft";
const draftExcerpt = "A neighborhood cinema opening night";
const listPattern = /\/api\/v1\/workspaces\/[^/]+\/studio-drafts(?:\?.*)?$/;

function draftSummary() {
  return {
    id: draftId,
    schemaVersion: "studioDraft.v1",
    workspaceId,
    displayExcerpt: draftExcerpt,
    step: "footage",
    createdAt: now,
    updatedAt: now,
  };
}

function draftDetail() {
  return {
    draft: {
      ...draftSummary(),
      payload: {
        v: 1,
        step: "footage",
        draft: {
          goal: draftExcerpt,
          targetLengthSec: 10,
          aspectRatio: "9:16",
          footageChoice: "prompt_only",
        },
      },
    },
  };
}

test.beforeEach(async ({ page }) => {
  await mockLocalApi(page);
  await page.route(listPattern, (route) =>
    json(route, { drafts: [draftSummary()], pagination: { limit: 20, nextCursor: null } }),
  );
});

test("saved draft acknowledges opening immediately and fences repeat actions @mobile", async ({
  page,
}) => {
  const detailGate = deferred();
  const detailStarted = deferred();
  let detailRequests = 0;
  await page.route(`**/api/v1/workspaces/*/studio-drafts/${draftId}`, async (route) => {
    detailRequests += 1;
    detailStarted.resolve();
    await detailGate.promise;
    await json(route, draftDetail());
  });

  await page.goto("/projects/new");
  const draftButton = page.getByRole("button", { name: new RegExp(draftExcerpt) });
  await draftButton.focus();
  await draftButton.press("Enter");
  await detailStarted.promise;

  const openingButton = page.getByRole("button", { name: `Opening draft ${draftExcerpt}` });
  await expect(openingButton).toBeFocused();
  await expect(openingButton).toHaveAttribute("aria-busy", "true");
  await expect(openingButton).toContainText("Opening draft…");
  await expect(page.getByRole("button", { name: "Delete" })).toBeDisabled();
  await openingButton.dispatchEvent("click");
  expect(detailRequests).toBe(1);

  detailGate.resolve();
  await expect(page).toHaveURL(new RegExp(`/projects/new\\?draft=${draftId}`));
  await expect(
    page.getByRole("heading", { name: "Do you have source material for the video?" }),
  ).toBeVisible();
});

test("a failed draft open restores the row for an exact retry", async ({ page }) => {
  let fail = true;
  let detailRequests = 0;
  await page.route(`**/api/v1/workspaces/*/studio-drafts/${draftId}`, async (route) => {
    detailRequests += 1;
    if (fail) {
      await json(route, { error: "The draft is temporarily unavailable." }, 404);
      return;
    }
    await json(route, draftDetail());
  });

  await page.goto("/projects/new");
  await page.getByRole("button", { name: new RegExp(draftExcerpt) }).click();
  await expect(page.getByText("Could not open that draft. Try again.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete" })).toBeEnabled();
  expect(detailRequests).toBe(1);

  fail = false;
  await page.getByRole("button", { name: new RegExp(draftExcerpt) }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/new\\?draft=${draftId}`));
  expect(detailRequests).toBe(2);
});

test("a failed direct draft link returns to the list without retrying itself", async ({
  page,
}) => {
  let fail = true;
  let detailRequests = 0;
  await page.route("**/api/v1/workspaces/*/studio-drafts/missing-draft", async (route) => {
    detailRequests += 1;
    if (fail) {
      await json(route, { error: "missing draft" }, 404);
      return;
    }
    await json(route, {
      draft: {
        ...draftDetail().draft,
        id: "missing-draft",
      },
    });
  });

  await page.goto("/projects/new?draft=missing-draft");
  await expect(page).toHaveURL(/\/projects\/new$/);
  await expect(page.getByText("Could not open that draft. Try again.")).toBeVisible();
  await page.waitForTimeout(250);
  expect(detailRequests).toBe(1);

  fail = false;
  await page.evaluate(() => {
    window.history.pushState({}, "", "/projects/new?draft=missing-draft");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL(/\/projects\/new\?draft=missing-draft$/);
  await expect(
    page.getByRole("heading", { name: "Do you have source material for the video?" }),
  ).toBeVisible();
  expect(detailRequests).toBe(2);
});

test("leaving Studio prevents a delayed draft response from reclaiming navigation", async ({
  page,
}) => {
  const detailGate = deferred();
  const detailStarted = deferred();
  await page.route(`**/api/v1/workspaces/*/studio-drafts/${draftId}`, async (route) => {
    detailStarted.resolve();
    await detailGate.promise;
    await json(route, draftDetail());
  });

  await page.goto("/projects/new");
  await page.getByRole("button", { name: new RegExp(draftExcerpt) }).click();
  await detailStarted.promise;
  await page.goto("/create");
  detailGate.resolve();
  await page.waitForTimeout(250);
  await expect(page).toHaveURL(/\/create$/);
});
