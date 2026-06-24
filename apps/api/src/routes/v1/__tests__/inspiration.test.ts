import assert from "node:assert/strict";
import test from "node:test";

import { posterPromptFor } from "../inspiration";

type StoryElementCategory =
  | "plot_type"
  | "setting"
  | "character_arc"
  | "belief_shift"
  | "structure"
  | "antagonist_type"
  | "stakes"
  | "theme";

const element = (id: string, category: StoryElementCategory, name: string) => ({
  id,
  category,
  groupSlug: null,
  slug: id,
  name,
  coreIdea: null,
});

test("poster prompt asks for the movie title as readable typography", () => {
  const prompt = posterPromptFor({
    movieTitle: "The Stranded Crew",
    logline: "A disgraced lawyer must rescue a stranded crew before dawn.",
    premise: "A salvage diver races a collapsing rig to save the people who wrote her off.",
    signature: "test-signature",
    ingredients: {
      plot: { emoji: "🎯", summary: "Impossible rescue" },
      setting: { emoji: "🌊", summary: "Doomed offshore rig" },
      arc: { emoji: "🦋", summary: "Cynic learns to trust" },
      antagonist: { emoji: "🏢", summary: "Negligent corporation" },
      theme: { emoji: "🤝", summary: "Redemption through others" },
      stakes: { emoji: "⏱️", summary: "Lives lost at dawn" },
      structure: { emoji: "⏳", summary: "Ticking clock" },
    },
    elements: {
      plot: [element("p1", "plot_type", "Rescue")],
      setting: [element("s1", "setting", "Offshore oil rig")],
      arc: [element("a1", "character_arc", "Cynic to believer")],
      antagonist: [element("an1", "antagonist_type", "Corporation")],
      theme: [element("t1", "theme", "Redemption")],
      stakes: [element("st1", "stakes", "Survival")],
      structure: [element("str1", "structure", "Ticking clock")],
    },
  });

  assert.match(prompt, /Movie title: "The Stranded Crew"/);
  assert.match(prompt, /large readable poster typography/);
  assert.match(prompt, /Offshore oil rig/);
  assert.doesNotMatch(prompt, /no readable typography/);
});
