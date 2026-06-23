import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { providerFor } from "../providers";

test("providerFor resolves video and image provider aliases", () => {
  assert.equal(providerFor("kling").name, "kling");
  assert.equal(providerFor("kling-ai").name, "kling");
  assert.equal(providerFor("seedance-2.0").name, "seedance");
  assert.equal(providerFor("grok-imagine").name, "xai");
  assert.equal(providerFor("xai").name, "xai");
});

async function tempImagePath(name: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "popcorn-provider-test-"));
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, Buffer.from("image-bytes"));
  return filePath;
}

test("Seedance routes referenced clips to fal image-to-video", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.FAL_KEY;
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  const referencePath = await tempImagePath("seedance.png");

  process.env.FAL_KEY = "fal-test-key";
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (url.endsWith("/status")) {
      return new Response(JSON.stringify({ status: "COMPLETED" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/response")) {
      return new Response(JSON.stringify({ video: { url: "https://media.test/seedance.mp4" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url === "https://media.test/seedance.mp4") {
      return new Response("mp4", { status: 200, headers: { "content-type": "video/mp4" } });
    }
    return new Response(
      JSON.stringify({
        request_id: "seedance-request",
        status_url:
          "https://queue.fal.run/bytedance/seedance-2.0/image-to-video/requests/seedance-request/status",
        response_url:
          "https://queue.fal.run/bytedance/seedance-2.0/image-to-video/requests/seedance-request/response",
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    await providerFor("seedance").generateAsset({
      provider: "seedance",
      kind: "video",
      model: "bytedance/seedance-2.0/text-to-video",
      prompt: "Animate this keyframe.",
      referencePaths: [referencePath],
    });
    assert.equal(
      calls[0].url,
      "https://queue.fal.run/bytedance/seedance-2.0/image-to-video"
    );
    assert.equal(typeof calls[0].body?.image_url, "string");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FAL_KEY;
    else process.env.FAL_KEY = previousKey;
  }
});

test("Kling image-to-video sends raw base64 without a data URI prefix", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.KLING_API_KEY;
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  const referencePath = await tempImagePath("kling.png");

  process.env.KLING_API_KEY = "kling-test-key";
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (url.endsWith("/task_1")) {
      return new Response(
        JSON.stringify({
          data: {
            task_status: "succeed",
            task_result: { videos: [{ url: "https://media.test/kling.mp4" }] },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url === "https://media.test/kling.mp4") {
      return new Response("mp4", { status: 200, headers: { "content-type": "video/mp4" } });
    }
    return new Response(JSON.stringify({ data: { task_id: "task_1" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await providerFor("kling").generateAsset({
      provider: "kling",
      kind: "video",
      prompt: "Animate this keyframe.",
      referencePaths: [referencePath],
    });
    assert.equal(calls[0].url, "https://api-singapore.klingai.com/v1/videos/image2video");
    assert.equal(calls[0].body?.image, Buffer.from("image-bytes").toString("base64"));
    assert.ok(!String(calls[0].body?.image).startsWith("data:"));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.KLING_API_KEY;
    else process.env.KLING_API_KEY = previousKey;
  }
});

test("xAI referenced video requests use the image-to-video model", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.XAI_API_KEY;
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  const referencePath = await tempImagePath("xai.png");

  process.env.XAI_API_KEY = "xai-test-key";
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (url.endsWith("/videos/request_1")) {
      return new Response(
        JSON.stringify({
          status: "done",
          model: "grok-imagine-video-1.5",
          video: { url: "https://media.test/xai.mp4", duration: 5 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    if (url === "https://media.test/xai.mp4") {
      return new Response("mp4", { status: 200, headers: { "content-type": "video/mp4" } });
    }
    return new Response(JSON.stringify({ request_id: "request_1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await providerFor("xai").generateAsset({
      provider: "xai",
      kind: "video",
      model: "grok-imagine-video",
      prompt: "Animate this keyframe.",
      referencePaths: [referencePath],
    });
    assert.equal(calls[0].url, "https://api.x.ai/v1/videos/generations");
    assert.equal(calls[0].body?.model, "grok-imagine-video-1.5");
    assert.ok(calls[0].body?.image);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = previousKey;
  }
});
