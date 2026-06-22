import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "@/core/errors";
import { parseManualIdeogramImageTestRequest } from "../manual-tests";

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
