import assert from "node:assert/strict";
import test from "node:test";

import { rankStoryConcepts, type InspirationCandidate } from "../inspiration";
import type { LlmClient, StructuredArgs } from "../../llm";

const candidate: InspirationCandidate = {
  plot: [{ name: "Rescue mission", coreIdea: "A rescue that costs the rescuer something." }],
  setting: [{ name: "Floating night market", coreIdea: "Commerce on lantern boats." }],
  arc: [{ name: "Control to trust", coreIdea: "A planner learns to rely on others." }],
  antagonist: [{ name: "Debt collector", coreIdea: "A lawful threat with personal leverage." }],
  theme: [{ name: "Mutual obligation", coreIdea: "Care as a social contract." }],
  stakes: [{ name: "Community exile", coreIdea: "Failure means losing the only home left." }],
  structure: [{ name: "One night", coreIdea: "A compressed deadline." }],
};

function concept(index: number, movieTitle: string, logline: string, originality: number) {
  return {
    index,
    movieTitle,
    logline,
    premise: `${movieTitle} premise.`,
    ingredients: {
      plot: { emoji: "P", summary: "Costly rescue" },
      setting: { emoji: "S", summary: "Lantern market" },
      arc: { emoji: "A", summary: "Trust earned" },
      antagonist: { emoji: "N", summary: "Legal pressure" },
      theme: { emoji: "T", summary: "Mutual care" },
      stakes: { emoji: "K", summary: "Home at risk" },
      structure: { emoji: "R", summary: "One night" },
    },
    scores: { coherence: 80, originality, hook: 75 },
  };
}

test("rankStoryConcepts revises generated concepts through an anti-cliche pass", async () => {
  const calls: StructuredArgs[] = [];
  const fakeClient: LlmClient = {
    provider: "openai",
    model: "fake",
    async structured<T>(args: StructuredArgs): Promise<T> {
      calls.push(args);
      if (calls.length === 1) {
        return {
          concepts: [
            concept(
              0,
              "The Chosen Current",
              "An unlikely hero must save the floating market before it is too late.",
              42
            ),
          ],
        } as T;
      }
      return {
        concepts: [
          concept(
            0,
            "Lantern Debt",
            "A ferry accountant hides a banned family ledger inside a floating market's nightly rescue route.",
            91
          ),
        ],
      } as T;
    },
    async structuredVision<T>(): Promise<T> {
      throw new Error("not used");
    },
    async chooseTool() {
      throw new Error("not used");
    },
  };

  const ranked = await rankStoryConcepts([candidate], fakeClient);

  assert.equal(calls.length, 2);
  assert.match(calls[0].cachedSystem, /Privately try at least four angles/);
  assert.match(calls[0].cachedSystem, /Avoid these phrases/);
  assert.match(calls[1].cachedSystem, /anti-cliche pass/);
  assert.match(calls[1].user, /The Chosen Current/);
  assert.equal(ranked[0].movieTitle, "Lantern Debt");
  assert.equal(ranked[0].scores.originality, 91);
  assert.equal(ranked[0].total, 246);
});
