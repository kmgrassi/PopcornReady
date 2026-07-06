import { expect, test, type Page } from "@playwright/test";

const REQUIRED_ICON_SIZES = ["192x192", "512x512"];

test.beforeEach(({}, testInfo) => {
  expect(
    testInfo.project.name,
    "PWA specs must run through the production preview-backed `pwa` project.",
  ).toBe("pwa");
});

test("manifest declares install and share-target metadata", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/manifest+json");

  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: "Popcorn Ready",
    start_url: "/",
    display: "standalone",
    share_target: {
      action: "/share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        files: [
          {
            name: "media",
            accept: ["video/*", "image/*"],
          },
        ],
      },
    },
  });

  expect(Array.isArray(manifest.icons)).toBe(true);
  for (const size of REQUIRED_ICON_SIZES) {
    const icon = manifest.icons.find(
      (entry: { sizes?: string; src?: string; type?: string }) =>
        entry.sizes === size && entry.type === "image/png" && entry.src,
    );
    expect(icon, `missing ${size} PNG icon`).toBeTruthy();

    const iconResponse = await request.get(icon.src);
    expect(iconResponse.ok(), `${icon.src} should be fetchable`).toBe(true);
  }
});

test("share-target service worker registers in the production build", async ({
  page,
}) => {
  await openControlledPwaPage(page);

  const scriptURL = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL);
  expect(scriptURL).toContain("/share-target-sw.js");
});

test("service worker accepts a shared file and routes it into the upload flow", async ({
  page,
}) => {
  await openControlledPwaPage(page);

  const shareResult = await page.evaluate(async () => {
    const body = new FormData();
    body.append(
      "media",
      new File([new Uint8Array([137, 80, 78, 71])], "shared-fixture.png", {
        type: "image/png",
      }),
    );

    const response = await fetch("/share-target", {
      method: "POST",
      body,
      redirect: "follow",
    });

    return {
      redirected: response.redirected,
      status: response.status,
      url: response.url,
    };
  });

  expect(shareResult.status).toBe(200);
  expect(shareResult.redirected).toBe(true);
  expect(new URL(shareResult.url).searchParams.get("share-target")).toBe("ready");

  await page.goto("/?share-target=ready");
  const sharedFootage = page.getByRole("region", {
    name: "Shared footage ready for upload",
  });
  await expect(sharedFootage).toBeVisible();
  await expect(sharedFootage.getByText("shared-fixture.png")).toBeVisible();
});

async function openControlledPwaPage(page: Page) {
  await page.goto("/");
  const supportsServiceWorkers = await page.evaluate(() => {
    if (!("serviceWorker" in navigator)) {
      return false;
    }
    return true;
  });
  expect(supportsServiceWorkers, "service workers are not supported in this browser").toBe(
    true,
  );

  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const registrations = await navigator.serviceWorker.getRegistrations();
          return registrations
            .map((registration) => registration.active?.scriptURL)
            .filter(Boolean);
        }),
      {
        message:
          "expected the production build to register /share-target-sw.js; dev server runs should fail here",
        timeout: 10_000,
      },
    )
    .toContainEqual(expect.stringContaining("/share-target-sw.js"));

  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null), {
      timeout: 10_000,
    })
    .toEqual(expect.stringContaining("/share-target-sw.js"));
}
