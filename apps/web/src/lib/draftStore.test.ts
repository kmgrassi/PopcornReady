import test from "node:test";
import assert from "node:assert/strict";
import {
  STUDIO_DRAFT_PAYLOAD_VERSION,
  payloadFromUnknown,
  recordFromUnknown,
} from "./draftStore";

test("payloadFromUnknown parses valid stored drafts without trusting raw casts", () => {
  const payload = payloadFromUnknown({
    v: STUDIO_DRAFT_PAYLOAD_VERSION,
    step: "story",
    projectId: "project_123",
    runId: "run_123",
    draft: {
      goal: "Launch teaser",
      targetLengthSec: 60,
      aspectRatio: "16:9",
      projectName: "Trailer",
      footageChoice: "upload",
      footageMode: "asset_driven",
      audience: "founders",
      platform: "youtube",
      format: "challenge",
      hook: "What if trailers wrote themselves?",
      bestVisual: "Before and after cut",
      bigIdea: "Automation still needs taste",
      payoff: "A polished launch video",
      accuracyNote: "Avoid claiming full autonomy",
      style: "cinematic",
      callToAction: "Book a demo",
      provider: "openai",
    },
  });

  assert.ok(payload);
  assert.equal(payload.step, "plan");
  assert.equal(payload.projectId, "project_123");
  assert.equal(payload.runId, "run_123");
  assert.equal(payload.draft.aspectRatio, "16:9");
  assert.equal(payload.draft.footageChoice, "upload");
  assert.equal(payload.draft.footageMode, "hybrid");
  assert.deepEqual(payload.draft.selectedFootage, []);
});

test("payloadFromUnknown drops retired run-config fields from old drafts", () => {
  const payload = payloadFromUnknown({
    v: STUDIO_DRAFT_PAYLOAD_VERSION,
    step: "brief",
    draft: {
      goal: "Saved before the run-config cleanup",
      seedKind: "video",
      seedSize: "1920x1080",
      showCaptions: false,
      reviewGates: ["storyboard", "export"],
    },
  });

  assert.ok(payload);
  assert.equal(payload.draft.goal, "Saved before the run-config cleanup");
  assert.ok(!("seedKind" in payload.draft));
  assert.ok(!("seedSize" in payload.draft));
  assert.ok(!("showCaptions" in payload.draft));
  assert.ok(!("reviewGates" in payload.draft));
});

test("payloadFromUnknown falls back for invalid enum-like values", () => {
  const payload = payloadFromUnknown({
    v: STUDIO_DRAFT_PAYLOAD_VERSION,
    step: "generate",
    draft: {
      goal: "Keep the brief",
      aspectRatio: "4:3",
      footageChoice: "bad_choice",
      footageMode: "bad_mode",
      platform: "myspace",
      format: "docuseries",
    },
  });

  assert.ok(payload);
  assert.equal(payload.step, "plan");
  assert.equal(payload.draft.aspectRatio, "9:16");
  assert.equal(payload.draft.footageChoice, "prompt_only");
  assert.equal(payload.draft.footageMode, "hybrid");
  assert.equal(payload.draft.platform, "tiktok");
  assert.equal(payload.draft.format, "visual_reveal");
});

test("recordFromUnknown synthesizes a safe fallback payload when payload is unreadable", () => {
  const record = recordFromUnknown({
    id: "draft_123",
    step: "export",
    projectId: "project_123",
    runId: "run_123",
    payload: { v: 999, draft: {} },
  });

  assert.ok(record);
  assert.equal(record.draftId, "draft_123");
  assert.equal(record.step, "export");
  assert.equal(record.payload.projectId, "project_123");
  assert.equal(record.payload.runId, "run_123");
  assert.equal(record.payload.step, "export");
  assert.equal(record.payload.draft.goal, "");
});
