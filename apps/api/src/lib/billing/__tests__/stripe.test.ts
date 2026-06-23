import assert from "node:assert/strict";
import test from "node:test";
import { CREDIT_PACKS, isCreditPackId } from "../stripe";

test("credit packs are $0.01/credit with no purchase markup", () => {
  for (const [id, pack] of Object.entries(CREDIT_PACKS)) {
    assert.equal(pack.credits, pack.usd * 100, `pack ${id}: $${pack.usd} should buy ${pack.usd * 100} credits`);
  }
});

test("isCreditPackId accepts known packs only", () => {
  assert.ok(isCreditPackId("10"));
  assert.ok(isCreditPackId("25"));
  assert.ok(isCreditPackId("50"));
  assert.ok(!isCreditPackId("99"));
  assert.ok(!isCreditPackId(""));
});
