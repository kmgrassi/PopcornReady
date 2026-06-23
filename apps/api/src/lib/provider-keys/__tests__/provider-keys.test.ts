import assert from "node:assert/strict";
import test from "node:test";

process.env.PROVIDER_API_KEYS_ENCRYPTION_SECRET = "test-secret-at-least-32-chars-long-xxxx";

import { decryptApiKey, encryptApiKey, keyHint } from "../crypto";
import {
  billableUsdSoFar,
  currentRunUserId,
  noteBillableGeneration,
  resolveProviderApiKey,
  resolveProviderKey,
  withProviderKeyUser,
} from "../resolve";

test("encryptApiKey -> decryptApiKey round-trips", () => {
  const secret = "sk-proj-abc123-the-real-key";
  const ciphertext = encryptApiKey(secret);
  assert.ok(ciphertext.startsWith("v1."));
  assert.notEqual(ciphertext, secret);
  assert.equal(decryptApiKey(ciphertext), secret);
});

test("each encryption uses a fresh IV (ciphertexts differ, both decrypt)", () => {
  const a = encryptApiKey("same-key");
  const b = encryptApiKey("same-key");
  assert.notEqual(a, b);
  assert.equal(decryptApiKey(a), "same-key");
  assert.equal(decryptApiKey(b), "same-key");
});

test("decryptApiKey rejects a tampered ciphertext (GCM auth tag)", () => {
  const ct = encryptApiKey("secret");
  const parts = ct.split(".");
  parts[3] = Buffer.from("tampered-bytes").toString("base64url");
  assert.throws(() => decryptApiKey(parts.join(".")));
  assert.throws(() => decryptApiKey("not-a-valid-payload"));
});

test("keyHint masks the middle and never leaks the full key", () => {
  assert.equal(keyHint("sk-1234567890abcd"), "sk-1••••abcd");
  assert.equal(keyHint("short"), "••••");
});

test("resolveProviderApiKey falls back to the platform env key when no user is bound", async () => {
  process.env.OPENAI_API_KEY = "platform-openai";
  // No request/run context -> acting user is null -> platform env, no DB call.
  assert.equal(await resolveProviderApiKey("openai"), "platform-openai");
});

test("a null run user still resolves the platform key", async () => {
  process.env.GEMINI_API_KEY = "platform-gemini";
  const key = await withProviderKeyUser(null, () => resolveProviderApiKey("gemini"));
  assert.equal(key, "platform-gemini");
});

test("runway honors the RUNWAYML_API_SECRET / RUNWAY_API_KEY fallback order", async () => {
  delete process.env.RUNWAYML_API_SECRET;
  process.env.RUNWAY_API_KEY = "legacy-runway";
  assert.equal(await resolveProviderApiKey("runway"), "legacy-runway");
  process.env.RUNWAYML_API_SECRET = "primary-runway";
  assert.equal(await resolveProviderApiKey("runway"), "primary-runway");
});

test("billable tally accrues platform cost only, within a run context", async () => {
  await withProviderKeyUser(null, async () => {
    // No run user => provider resolves to the platform key => source 'platform'.
    await resolveProviderKey("openai");
    noteBillableGeneration("openai", 5);
    assert.equal(billableUsdSoFar(), 5);

    // A provider whose key was never resolved this run is not billed.
    noteBillableGeneration("ltx", 3);
    assert.equal(billableUsdSoFar(), 5);

    // Further platform cost accrues.
    await resolveProviderKey("gemini");
    noteBillableGeneration("gemini", 2.5);
    assert.equal(billableUsdSoFar(), 7.5);
  });
});

test("no billing tally or run user outside a run context", () => {
  assert.equal(currentRunUserId(), null);
  assert.equal(billableUsdSoFar(), 0);
  noteBillableGeneration("openai", 10); // no-op: nothing to accrue onto
  assert.equal(billableUsdSoFar(), 0);
});
