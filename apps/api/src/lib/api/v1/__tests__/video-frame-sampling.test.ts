import assert from "node:assert/strict";
import test from "node:test";
import { videoSampleTimes } from "../video-frame-sampling";

test("video critique samples representative interior frames", () => {
  assert.deepEqual(videoSampleTimes(undefined, 4, 6), [0]);
  assert.deepEqual(videoSampleTimes(10, 4, 6), [1.96, 3.92, 5.88, 7.84]);
  assert.equal(videoSampleTimes(180, 4, 6).length, 6);
});
