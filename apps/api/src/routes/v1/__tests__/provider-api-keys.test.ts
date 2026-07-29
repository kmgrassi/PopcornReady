import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "@/core/errors";

import { readBodyObject, readKey } from "../provider-api-keys";

test("provider API-key body parsing preserves the typed request boundary", () => {
  const body = readBodyObject({ apiKey: "sk-example-key" });

  assert.equal(readKey(body), "sk-example-key");
});

test("provider API-key body parsing rejects non-object request bodies", () => {
  for (const body of [null, "api-key", 42, [], undefined]) {
    assert.throws(
      () => readBodyObject(body),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.code, "validation_failed");
        assert.equal(error.message, "Request body must be an object.");
        return true;
      }
    );
  }
});

test("provider API-key parsing rejects missing or non-string keys", () => {
  for (const body of [{}, { apiKey: 123 }, { apiKey: "short" }]) {
    assert.throws(
      () => readKey(readBodyObject(body)),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.code, "validation_failed");
        assert.match(error.message, /API key with at least 8 characters/i);
        return true;
      }
    );
  }
});
