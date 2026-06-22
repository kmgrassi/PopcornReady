import assert from "node:assert/strict";
import test from "node:test";
import { providerFor } from "../providers";

function formValue(body: unknown, key: string): FormDataEntryValue | null {
  assert.ok(body instanceof FormData, "request body should be FormData");
  return body.get(key);
}

test("providerFor resolves Ideogram", () => {
  assert.equal(providerFor("ideogram").name, "ideogram");
});

test("Ideogram provider maps v4 image requests and downloads ephemeral URLs", async () => {
  const previousKey = process.env.IDEOGRAM_API_KEY;
  const previousFetch = globalThis.fetch;
  const requests: Array<{ url: string; body?: unknown; headers: Headers }> = [];

  process.env.IDEOGRAM_API_KEY = "ideogram-test-key";
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      body: init?.body,
      headers: new Headers(init?.headers),
    });

    if (String(input).includes("/v1/ideogram-v4/generate")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              prompt: "A sharper generated prompt.",
              url: "https://ideogram.ai/api/images/ephemeral/generated.png",
            },
          ],
          response_type: "url",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(Buffer.from("png-bytes"), {
      status: 200,
      headers: { "Content-Type": "image/png" },
    });
  };

  try {
    const result = await providerFor("ideogram").generateAsset({
      provider: "ideogram",
      kind: "image",
      model: "ideogram-v4",
      prompt: "A product poster with crisp typography.",
      size: "2048x2048",
      renderingSpeed: "QUALITY",
      enableCopyrightDetection: true,
    });

    assert.equal(result.provider, "ideogram");
    assert.equal(result.model, "ideogram-v4");
    assert.equal(result.mimeType, "image/png");
    assert.deepEqual(result.bytes, Buffer.from("png-bytes"));
    assert.equal(result.prompt, "A sharper generated prompt.");
    assert.equal(requests[0].url, "https://api.ideogram.ai/v1/ideogram-v4/generate");
    assert.equal(requests[0].headers.get("api-key"), "ideogram-test-key");
    assert.equal(formValue(requests[0].body, "text_prompt"), "A product poster with crisp typography.");
    assert.equal(formValue(requests[0].body, "resolution"), "2048x2048");
    assert.equal(formValue(requests[0].body, "rendering_speed"), "QUALITY");
    assert.equal(formValue(requests[0].body, "enable_copyright_detection"), "true");
    assert.equal(requests[1].url, "https://ideogram.ai/api/images/ephemeral/generated.png");
  } finally {
    if (previousKey === undefined) delete process.env.IDEOGRAM_API_KEY;
    else process.env.IDEOGRAM_API_KEY = previousKey;
    globalThis.fetch = previousFetch;
  }
});

test("Ideogram provider maps v3 image options", async () => {
  const previousKey = process.env.IDEOGRAM_API_KEY;
  const previousFetch = globalThis.fetch;
  const requests: Array<{ url: string; body?: unknown; headers: Headers }> = [];

  process.env.IDEOGRAM_API_KEY = "ideogram-test-key";
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      body: init?.body,
      headers: new Headers(init?.headers),
    });

    if (String(input).includes("/v1/ideogram-v3/generate")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              prompt: "A cat in a clean layout.",
              url: "https://ideogram.ai/api/images/ephemeral/v3.webp",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(Buffer.from("webp-bytes"), {
      status: 200,
      headers: { "Content-Type": "image/webp" },
    });
  };

  try {
    const result = await providerFor("ideogram").generateAsset({
      provider: "ideogram",
      kind: "image",
      model: "ideogram-v3",
      prompt: "A cat in a clean layout.",
      aspectRatio: "16x9",
      renderingSpeed: "TURBO",
      magicPrompt: "OFF",
      negativePrompt: "blur, watermark",
      numImages: 2,
      seed: 123,
      styleType: "DESIGN",
      stylePreset: "C4D_CARTOON",
    });

    assert.equal(result.model, "ideogram-v3");
    assert.equal(result.extension, "webp");
    assert.equal(result.mimeType, "image/webp");
    assert.equal(requests[0].url, "https://api.ideogram.ai/v1/ideogram-v3/generate");
    assert.equal(formValue(requests[0].body, "prompt"), "A cat in a clean layout.");
    assert.equal(formValue(requests[0].body, "aspect_ratio"), "16x9");
    assert.equal(formValue(requests[0].body, "rendering_speed"), "TURBO");
    assert.equal(formValue(requests[0].body, "magic_prompt"), "OFF");
    assert.equal(formValue(requests[0].body, "negative_prompt"), "blur, watermark");
    assert.equal(formValue(requests[0].body, "num_images"), "2");
    assert.equal(formValue(requests[0].body, "seed"), "123");
    assert.equal(formValue(requests[0].body, "style_type"), "DESIGN");
    assert.equal(formValue(requests[0].body, "style_preset"), "C4D_CARTOON");
  } finally {
    if (previousKey === undefined) delete process.env.IDEOGRAM_API_KEY;
    else process.env.IDEOGRAM_API_KEY = previousKey;
    globalThis.fetch = previousFetch;
  }
});
