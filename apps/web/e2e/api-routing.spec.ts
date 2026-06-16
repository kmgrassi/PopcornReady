import { expect, test } from "@playwright/test";

test.describe("deploy-style API routing", () => {
  test("serves health JSON through the web /api proxy", async ({ request }) => {
    const response = await request.get("/api/v1/health");

    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("application/json");

    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(["local", "supabase", "hybrid"]).toContain(body.authMode);
    expect(new Date(body.time).toString()).not.toBe("Invalid Date");
  });

  test("keeps API misses in the JSON error envelope instead of SPA HTML", async ({ request }) => {
    const response = await request.get("/api/v1/not-a-real-route");

    expect(response.status()).toBe(404);
    expect(response.headers()["content-type"]).toContain("application/json");

    const text = await response.text();
    expect(text.trimStart()).not.toMatch(/^</);

    const body = JSON.parse(text);
    expect(body).toMatchObject({
      error: {
        code: "not_found",
      },
    });
    expect(body.error.message).toContain("No route for GET /api/v1/not-a-real-route.");
    expect(body.error.requestId).toEqual(expect.any(String));
  });
});
