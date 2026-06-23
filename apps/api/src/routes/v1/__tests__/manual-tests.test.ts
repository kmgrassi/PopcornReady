import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "@/core/errors";
import {
  buildManualProviderAssetBody,
  parseManualIdeogramImageTestRequest,
  parseManualProviderAssetTestRequest,
} from "../manual-tests";

test("manual Ideogram test parser accepts a single prompt and optional model", () => {
  assert.deepEqual(
    parseManualIdeogramImageTestRequest({
      prompt: "  A clean poster for a launch event.  ",
      model: "ideogram-v3",
    }),
    {
      prompt: "A clean poster for a launch event.",
      model: "ideogram-v3",
    }
  );
});

test("manual Ideogram test parser requires a prompt", () => {
  assert.throws(
    () => parseManualIdeogramImageTestRequest({ prompt: " " }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, "validation_failed");
      assert.match(err.message, /prompt is required/);
      return true;
    }
  );
});

test("manual Ideogram test parser limits model selection to Ideogram generate models", () => {
  assert.throws(
    () => parseManualIdeogramImageTestRequest({ prompt: "x", model: "openai" }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, "validation_failed");
      assert.match(err.message, /ideogram-v4 or ideogram-v3/);
      return true;
    }
  );
});

test("manual provider asset parser accepts a video smoke test", () => {
  assert.deepEqual(
    parseManualProviderAssetTestRequest({
      kind: "video",
      provider: "kling",
      prompt: "  A launch clip.  ",
      model: "kling-v3",
      aspectRatio: "16:9",
      durationSec: 5,
    }),
    {
      kind: "video",
      provider: "kling",
      prompt: "A launch clip.",
      model: "kling-v3",
      aspectRatio: "16:9",
      durationSec: 5,
    }
  );
});

test("manual provider asset body maps aspect ratio to provider-read size", () => {
  const input = parseManualProviderAssetTestRequest({
    kind: "video",
    provider: "kling",
    prompt: "A launch clip.",
    model: "kling-v3",
    aspectRatio: "9:16",
    durationSec: 5,
  });

  assert.deepEqual(buildManualProviderAssetBody(input), {
    kind: "video",
    provider: "kling",
    prompt: "A launch clip.",
    assetRole: "provider_smoke_test",
    displayName: "Provider smoke test video",
    slug: "provider-smoke-video",
    model: "kling-v3",
    size: "720x1280",
    durationSec: 5,
  });
});

test("manual provider asset body maps NVIDIA aspect ratio to resolution", () => {
  const input = parseManualProviderAssetTestRequest({
    kind: "video",
    provider: "nvidia_api_catalog",
    prompt: "A launch clip.",
    aspectRatio: "16:9",
  });

  assert.deepEqual(buildManualProviderAssetBody(input), {
    kind: "video",
    provider: "nvidia_api_catalog",
    prompt: "A launch clip.",
    assetRole: "provider_smoke_test",
    displayName: "Provider smoke test video",
    slug: "provider-smoke-video",
    resolution: "480_16_9",
  });
});

test("manual provider asset parser rejects square aspect ratios when wrappers cannot express them", () => {
  assert.throws(
    () =>
      parseManualProviderAssetTestRequest({
        kind: "video",
        provider: "runway",
        prompt: "clip",
        aspectRatio: "1:1",
      }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, "validation_failed");
      assert.match(err.message, /1:1 is not supported/);
      return true;
    }
  );
});

test("manual provider asset parser rejects Gemini image aspect ratios", () => {
  assert.throws(
    () =>
      parseManualProviderAssetTestRequest({
        kind: "image",
        provider: "gemini",
        prompt: "poster",
        aspectRatio: "16:9",
      }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, "validation_failed");
      assert.match(err.message, /Gemini image smoke tests/);
      return true;
    }
  );
});

test("manual provider asset parser rejects providers for the wrong kind", () => {
  assert.throws(
    () =>
      parseManualProviderAssetTestRequest({
        kind: "image",
        provider: "kling",
        prompt: "poster",
      }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, "validation_failed");
      assert.match(err.message, /does not support image/);
      return true;
    }
  );
});

test("manual provider asset parser requires a prompt", () => {
  assert.throws(
    () =>
      parseManualProviderAssetTestRequest({
        kind: "video",
        provider: "xai",
        prompt: " ",
      }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, "validation_failed");
      assert.match(err.message, /prompt is required/);
      return true;
    }
  );
});
