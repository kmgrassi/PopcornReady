import { expect, test } from "@playwright/test";

const localSupabaseMode =
  (process.env.POPCORN_E2E_AUTH_MODE ?? "local").toLowerCase() === "supabase" &&
  process.env.VITE_SUPABASE_URL?.includes("127.0.0.1");

test.describe("local Supabase production-parity auth", () => {
  test.skip(
    !localSupabaseMode,
    "This test runs only through pnpm test:e2e:local-db with local Supabase.",
  );

  test("signs up, resolves the authenticated domain user, signs out, and signs back in", async ({ page }) => {
    const email = `e2e-${Date.now()}@popcornready.test`;
    const password = "LocalSupabaseE2E!42";

    await page.goto("/signup");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page).toHaveURL(/\/dashboard$/);

    const me = await page.evaluate(async () => {
      const authStorageKey = Object.keys(window.localStorage).find((key) =>
        key.endsWith("-auth-token"),
      );
      if (!authStorageKey) throw new Error("Expected a persisted Supabase session.");
      const accessToken = JSON.parse(window.localStorage.getItem(authStorageKey) ?? "{}")
        .access_token;
      if (typeof accessToken !== "string") throw new Error("Expected a Supabase access token.");
      const response = await fetch("/api/v1/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return { status: response.status, body: await response.json() };
    });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      authMode: "supabase",
      isLocal: false,
      actor: { type: "user", email },
    });

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
