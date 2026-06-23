import assert from "node:assert/strict";
import test from "node:test";
import { providerFor } from "../providers";

test("providerFor resolves video and image provider aliases", () => {
  assert.equal(providerFor("kling").name, "kling");
  assert.equal(providerFor("kling-ai").name, "kling");
  assert.equal(providerFor("seedance-2.0").name, "seedance");
  assert.equal(providerFor("grok-imagine").name, "xai");
  assert.equal(providerFor("xai").name, "xai");
});
