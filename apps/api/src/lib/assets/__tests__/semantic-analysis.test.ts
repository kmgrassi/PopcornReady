import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSemanticAnalysis } from "../semantic-analysis";

test("buildSemanticAnalysis creates transcript spans and moment segments", () => {
  const analysis = buildSemanticAnalysis(
    {
      id: "asset_1",
      kind: "video",
      durationSec: 10,
      source: { type: "local_path" },
      context: {
        transcriptText: "Open with the customer pain then show the product payoff.",
        recommendedRoles: ["hook", "demo"],
        moments: [
          { startSec: 0, endSec: 4, label: "customer pain" },
          { startSec: 4, endSec: 10, label: "product payoff" },
        ],
      },
    },
    { now: "2026-05-31T00:00:00.000Z" }
  );

  assert.equal(analysis.schemaVersion, "semanticAnalysis.v1");
  assert.equal(analysis.assetId, "asset_1");
  assert.equal(analysis.transcript.length, 2);
  assert.equal(
    analysis.transcript.reduce((count, span) => count + span.words.length, 0),
    10
  );
  assert.deepEqual(
    analysis.segments.map((segment) => segment.transcriptSpanIds),
    [["asset_1_span_1"], ["asset_1_span_2"]]
  );
  assert.deepEqual(
    analysis.segments.map((segment) => ({
      startMs: segment.startMs,
      endMs: segment.endMs,
      tags: segment.semanticTags,
    })),
    [
      {
        startMs: 0,
        endMs: 4000,
        tags: ["video", "local_path", "hook", "demo", "customer pain"],
      },
      {
        startMs: 4000,
        endMs: 10000,
        tags: ["video", "local_path", "hook", "demo", "product payoff"],
      },
    ]
  );
});

test("buildSemanticAnalysis keeps summaries out of transcript", () => {
  const analysis = buildSemanticAnalysis({
    id: "asset_summary",
    kind: "image",
    context: {
      summary: "A product screenshot with the dashboard open.",
      recommendedRoles: ["demo"],
    },
  });

  assert.deepEqual(analysis.transcript, []);
  assert.equal(
    analysis.segments[0].visualDescription,
    "A product screenshot with the dashboard open."
  );
});
