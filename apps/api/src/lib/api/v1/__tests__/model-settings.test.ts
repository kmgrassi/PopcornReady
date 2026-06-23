import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "@/core/errors";
import {
  defaultModelSettings,
  normalizeModelSettingsProvider,
  readModelSettingPurpose,
  readModelSettingsBody,
  resolveWorkspaceGenerationModel,
} from "../model-settings";

test("model settings expose defaults for each purpose", () => {
  const defaults = defaultModelSettings();
  assert.deepEqual(
    defaults.map((setting) => setting.purpose).sort(),
    ["audio_generation", "image_generation", "text_generation", "video_generation"]
  );
  assert.equal(
    defaults.find((setting) => setting.purpose === "image_generation")?.provider,
    "openai"
  );
  assert.equal(
    defaults.find((setting) => setting.purpose === "video_generation")?.provider,
    "gemini"
  );
  assert.equal(
    defaults.find((setting) => setting.purpose === "audio_generation")?.provider,
    "elevenlabs"
  );
});

test("model setting purpose parser validates known purposes", () => {
  assert.equal(readModelSettingPurpose("image_generation"), "image_generation");
  assert.equal(readModelSettingPurpose(" VIDEO_GENERATION "), "video_generation");
  assert.equal(readModelSettingPurpose("audio_generation"), "audio_generation");
  assert.throws(
    () => readModelSettingPurpose("caption_generation"),
    (err: unknown) => err instanceof ApiError && err.code === "validation_failed"
  );
});

test("model setting provider parser validates purpose support", () => {
  assert.equal(
    normalizeModelSettingsProvider("image_generation", "ideogram"),
    "ideogram"
  );
  assert.equal(
    normalizeModelSettingsProvider("video_generation", "nvidia"),
    "nvidia_api_catalog"
  );
  assert.equal(normalizeModelSettingsProvider("image_generation", "grok"), "xai");
  assert.equal(normalizeModelSettingsProvider("video_generation", "kling-ai"), "kling");
  assert.equal(
    normalizeModelSettingsProvider("video_generation", "seedance-2.0"),
    "seedance"
  );
  assert.throws(
    () => normalizeModelSettingsProvider("text_generation", "ideogram"),
    (err: unknown) => err instanceof ApiError && err.code === "validation_failed"
  );
  assert.equal(
    normalizeModelSettingsProvider("audio_generation", "elevenlabs"),
    "elevenlabs"
  );
  assert.throws(
    () => normalizeModelSettingsProvider("audio_generation", "openai"),
    (err: unknown) => err instanceof ApiError && err.code === "validation_failed"
  );
});

test("model setting body requires provider and model", () => {
  assert.deepEqual(readModelSettingsBody("text_generation", {
    provider: "anthropic",
    model: "claude-opus-4-7",
  }), {
    provider: "anthropic",
    model: "claude-opus-4-7",
  });
  assert.throws(
    () => readModelSettingsBody("image_generation", { provider: "openai", model: "" }),
    (err: unknown) => err instanceof ApiError && err.code === "validation_failed"
  );
});

test("generation model resolver falls back outside request context", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    assert.deepEqual(await resolveWorkspaceGenerationModel({
      workspaceId: "ws_background",
      kind: "audio",
    }), {
      provider: "elevenlabs",
      model: "eleven_multilingual_v2",
    });
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceKey;
  }
});
