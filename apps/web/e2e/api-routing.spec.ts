import { expect, test } from "@playwright/test";

test.describe("deploy-style API routing", () => {
  test("serves health JSON through the web /api proxy", async ({ request }) => {
    const response = await request.get("/api/v1/health");

    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("application/json");

    const body = await response.json();
    expect(body).toMatchObject({
      status: "ok",
      authMode: "supabase",
    });
    expect(new Date(body.time).toString()).not.toBe("Invalid Date");
  });

  test("keeps protected API misses in the JSON error envelope", async ({ request }) => {
    const response = await request.get("/api/v1/me");

    expect(response.status()).toBe(403);
    expect(response.headers()["content-type"]).toContain("application/json");

    const text = await response.text();
    expect(text.trimStart()).not.toMatch(/^</);

    const body = JSON.parse(text);
    expect(body).toMatchObject({
      error: {
        code: "forbidden",
        message: "Missing credentials.",
      },
    });
    expect(body.error.requestId).toEqual(expect.any(String));
  });
});
