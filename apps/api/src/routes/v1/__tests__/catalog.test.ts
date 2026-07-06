import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "@/core/errors";

import { assertCatalogWriteAllowed } from "../catalog";

test("catalog writes reject anonymous guest actors", () => {
  assert.throws(
    () => assertCatalogWriteAllowed({ actor: { isAnonymous: true } }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.code, "forbidden");
      assert.match(err.message, /anonymous guest sessions cannot/i);
      return true;
    }
  );
});

test("catalog writes allow permanent actors", () => {
  assert.doesNotThrow(() => assertCatalogWriteAllowed({ actor: {} }));
  assert.doesNotThrow(() => assertCatalogWriteAllowed({ actor: { isAnonymous: false } }));
});
