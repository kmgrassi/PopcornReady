import { expect, test } from "@playwright/test";

const apiPort = process.env.POPCORN_E2E_API_PORT ?? process.env.PLAYWRIGHT_API_PORT ?? "4100";
const apiOrigin = process.env.VITE_API_URL ?? `http://127.0.0.1:${apiPort}`;
const apiBase = `${apiOrigin.replace(/\/$/, "")}/api/v1`;
const hostedMode =
  (process.env.POPCORN_E2E_AUTH_MODE ?? "local").toLowerCase() === "supabase";
const hostedEmail = process.env.POPCORN_E2E_SUPABASE_EMAIL;
const hostedPassword = process.env.POPCORN_E2E_SUPABASE_PASSWORD;
const hasHostedConfig = Boolean(
  hostedMode &&
    hostedEmail &&
    hostedPassword &&
    process.env.VITE_SUPABASE_URL &&
    process.env.VITE_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
);

test.describe("hosted Supabase auth mode", () => {
  test.skip(
    !hasHostedConfig,
    "Hosted auth e2e requires POPCORN_E2E_AUTH_MODE=supabase, Supabase public env, service-role env, and test credentials.",
  );

  test("requires login, persists the account, resolves /me, and signs out", async ({
    page,
    request,
  }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Email").fill(hostedEmail!);
    await page.getByLabel("Password").fill(hostedPassword!);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText(hostedEmail!).first()).toBeVisible();
    await expect(page.getByText("Hosted mode").first()).toBeVisible();

    const me = await request.get(`${apiBase}/me`, {
      headers: {
        authorization: await page.evaluate(async () => {
          const { getSupabaseAccessToken } = await import(
            "/src/lib/supabase/browser.ts"
          );
          return `Bearer ${await getSupabaseAccessToken()}`;
        }),
      },
    });
    await expect(me).toBeOK();
    expect(me.headers()["content-type"]).toMatch(/application\/json/i);
    expect(await me.json()).toMatchObject({
      authMode: "supabase",
      isLocal: false,
      actor: {
        type: "user",
        email: hostedEmail,
      },
    });

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });
});
