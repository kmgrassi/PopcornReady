import assert from "node:assert/strict";
import test from "node:test";
import { formatRunStatusTime } from "./runStatusTime";

const now = Date.parse("2026-08-07T12:00:00.000Z");

function isoBefore(milliseconds: number) {
  return new Date(now - milliseconds).toISOString();
}

test("run status time uses deterministic relative thresholds", () => {
  assert.equal(formatRunStatusTime(isoBefore(59_000), now, "en-US")?.label, "Status updated just now");
  assert.equal(formatRunStatusTime(isoBefore(60_000), now, "en-US")?.label, "Status updated 1 min ago");
  assert.equal(formatRunStatusTime(isoBefore(59 * 60_000), now, "en-US")?.label, "Status updated 59 min ago");
  assert.equal(formatRunStatusTime(isoBefore(60 * 60_000), now, "en-US")?.label, "Status updated 1 hr ago");
  assert.equal(formatRunStatusTime(isoBefore(23 * 60 * 60_000), now, "en-US")?.label, "Status updated 23 hr ago");
  assert.match(
    formatRunStatusTime(isoBefore(24 * 60 * 60_000), now, "en-US")?.label ?? "",
    /^Status updated Aug 6, .+$/,
  );
});

test("run status time handles clock skew and invalid values truthfully", () => {
  assert.equal(
    formatRunStatusTime(new Date(now + 30_000).toISOString(), now, "en-US")?.label,
    "Status updated just now",
  );
  assert.equal(
    formatRunStatusTime(new Date(now + 61_000).toISOString(), now, "en-US")?.label,
    "Update time unavailable",
  );
  assert.equal(formatRunStatusTime("not-a-date", now, "en-US"), null);
});

test("run status time exposes machine-readable and absolute context", () => {
  const value = "2026-08-07T11:55:00.000Z";
  const label = formatRunStatusTime(value, now, "en-US");
  assert.equal(label?.dateTime, value);
  assert.equal(label?.label, "Status updated 5 min ago");
  assert.match(label?.title ?? "", /Aug 7, 2026/);
});
