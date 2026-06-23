import assert from "node:assert/strict";
import test from "node:test";
import { CREDIT_PACKS, checkoutReturnUrls, isCreditPackId } from "../stripe";

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

test("checkoutReturnUrls takes the first origin from a comma-separated WEB_ORIGIN", () => {
  delete process.env.CREDITS_RETURN_URL;
  process.env.WEB_ORIGIN = "https://popcornready.ai,https://www.popcornready.ai";
  const { success, cancel } = checkoutReturnUrls();
  assert.ok(success.startsWith("https://popcornready.ai/"), success);
  assert.ok(!success.includes(","), "must not embed the whole allowlist");
  assert.ok(cancel.startsWith("https://popcornready.ai/"));
});

test("CREDITS_RETURN_URL overrides WEB_ORIGIN", () => {
  process.env.CREDITS_RETURN_URL = "https://app.example.com/";
  process.env.WEB_ORIGIN = "https://popcornready.ai";
  assert.ok(checkoutReturnUrls().success.startsWith("https://app.example.com/library"));
});
