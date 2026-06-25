import "../src/env.js";
import { rankStoryConcepts, type InspirationCandidate } from "../src/lib/agent/inspiration";

// Two deliberately mismatched random draws (the "janky" case) + one workable one,
// to confirm the ranker reframes them into plausible concepts and scores sanely.
const candidates: InspirationCandidate[] = [
  {
    plot: [{ name: "Underdog competition", coreIdea: "A long shot fights to win" }],
    setting: [
      { name: "Deep sea research station", coreIdea: null },
      { name: "Near future", coreIdea: null },
    ],
    arc: [{ name: "Coward to brave", coreIdea: "Learns courage under pressure" }],
    antagonist: [{ name: "Technology", coreIdea: "A system out of control" }],
    theme: [{ name: "Grief", coreIdea: "Living past loss" }],
    stakes: [{ name: "Survival", coreIdea: null }],
    structure: [{ name: "Tournament", coreIdea: null }],
  },
  {
    plot: [{ name: "Heist", coreIdea: "Pull off the impossible job" }],
    setting: [
      { name: "1920s jazz city", coreIdea: null },
      { name: "Glittering casino", coreIdea: null },
    ],
    arc: [{ name: "Selfish to loyal", coreIdea: "Chooses the crew over the score" }],
    antagonist: [{ name: "Crime boss", coreIdea: null }],
    theme: [{ name: "Loyalty", coreIdea: null }],
    stakes: [{ name: "Freedom", coreIdea: null }],
    structure: [{ name: "Ticking clock", coreIdea: null }],
  },
  {
    plot: [{ name: "Forbidden romance", coreIdea: null }],
    setting: [
      { name: "Mars colony", coreIdea: null },
      { name: "Distant future", coreIdea: null },
    ],
    arc: [{ name: "Closed to open", coreIdea: null }],
    antagonist: [{ name: "Authoritarian state", coreIdea: null }],
    theme: [{ name: "Freedom", coreIdea: null }],
    stakes: [{ name: "Exile", coreIdea: null }],
    structure: [{ name: "Three act", coreIdea: null }],
  },
];

async function main() {
  const ranked = await rankStoryConcepts(candidates);
  console.log(`Ranked ${ranked.length} concepts (best first):\n`);
  for (const c of ranked) {
    console.log(`#${c.index}  total=${c.total}  ${JSON.stringify(c.scores)}`);
    console.log(`  TITLE:   ${c.movieTitle}`);
    console.log(`  LOGLINE: ${c.logline}`);
    console.log(`  PREMISE: ${c.premise}`);
    const emojis = Object.entries(c.ingredients)
      .map(([g, v]) => `${v.emoji} ${g}:${v.summary}`)
      .join(" | ");
    console.log(`  INGRED:  ${emojis}\n`);
  }
  // Assertions: sorted desc, indices unique + in range.
  const totals = ranked.map((c) => c.total);
  const sortedOk = totals.every((t, i) => i === 0 || totals[i - 1] >= t);
  const indices = ranked.map((c) => c.index);
  const indicesOk = new Set(indices).size === indices.length &&
    indices.every((i) => i >= 0 && i < candidates.length);
  console.log(`sorted desc: ${sortedOk} | indices valid+unique: ${indicesOk}`);
  if (!sortedOk || !indicesOk) process.exit(1);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
