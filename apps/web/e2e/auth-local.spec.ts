import { expect, test } from "@playwright/test";

const apiPort = process.env.POPCORN_E2E_API_PORT ?? process.env.PLAYWRIGHT_API_PORT ?? "4100";
const apiOrigin = process.env.VITE_API_URL ?? `http://127.0.0.1:${apiPort}`;
const apiBase = `${apiOrigin.replace(/\/$/, "")}/api/v1`;
const hasLocalStoreEnv = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

test.describe("local auth mode", () => {
  test.skip(
    (process.env.POPCORN_E2E_AUTH_MODE ?? "local").toLowerCase() !== "local",
    "Local auth assertions run only in the default local e2e mode.",
  );

  test("serves health JSON", async ({ request }) => {
    const health = await request.get(`${apiBase}/health`);
    await expect(health).toBeOK();
    expect(health.headers()["content-type"]).toMatch(/application\/json/i);
    expect(health.headers()["content-type"]).not.toMatch(/text\/html/i);
  });

  test("resolves the deterministic local workspace", async ({ request }) => {
    test.skip(
      !hasLocalStoreEnv,
      "The current local-mode /me contract uses the Supabase-backed store and requires SUPABASE_URL plus SUPABASE_SERVICE_ROLE_KEY.",
    );

    const me = await request.get(`${apiBase}/me`);
    await expect(me).toBeOK();
    expect(me.headers()["content-type"]).toMatch(/application\/json/i);

    const body = await me.json();
    expect(body).toMatchObject({
      authMode: "local",
      isLocal: true,
      actor: {
        id: "local_dev",
        type: "local",
      },
    });
    expect(body.workspaceId).toEqual(expect.any(String));
    expect(body.workspaceId.length).toBeGreaterThan(0);
  });

});
