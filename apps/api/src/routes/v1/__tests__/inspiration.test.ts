import assert from "node:assert/strict";
import test from "node:test";

import {
  describeAntagonistOptions,
  movieTitleFor,
  posterPromptFor,
} from "../inspiration";

const baseRow = {
  id: "row_1",
  category_slug: "antagonist_type",
  group_slug: "antagonist_types",
  slug: "technology",
  name: "Technology",
  core_idea: null,
  is_featured: false,
} as const;

test("technology antagonist has multiple generated phrasings", () => {
  const options = describeAntagonistOptions(
    [baseRow],
    [
      {
        ...baseRow,
        id: "theme_1",
        category_slug: "theme",
        group_slug: "themes",
        slug: "identity",
        name: "Identity",
      },
    ]
  );

  assert.ok(options.length > 1);
  assert.ok(options.includes("an AI-controlled entertainment monopoly"));
  assert.ok(options.some((option) => option.includes("identity")));
});

test("movie title is generated from inspiration fields", () => {
  const title = movieTitleFor({
    typeOfPerson: "disgraced junior lawyer",
    setting: "a kitchen in the nonlinear time",
    externalGoal: "rescue a stranded crew",
    antagonisticForce: "an algorithmic studio cartel optimizing identity",
    newTruth: "Success cannot replace identity",
    endingType: "a hard-won reconciliation",
  });

  assert.equal(typeof title, "string");
  assert.ok(title.length > 0);
  assert.ok(title.length <= 64);
});

test("poster prompt asks for the generated movie title as readable typography", () => {
  const prompt = posterPromptFor({
    formula: "",
    movieTitle: "The Stranded Crew",
    logline: "A disgraced junior lawyer wants to rescue a stranded crew.",
    typeOfPerson: "disgraced junior lawyer",
    setting: "a kitchen in the nonlinear time",
    externalGoal: "rescue a stranded crew",
    antagonisticForce: "an algorithmic studio cartel optimizing identity",
    innerFlawOrLie: "the belief that \"Success will make me whole\"",
    oldSelf: "trusting the system to stay fair",
    newTruth: "Success cannot replace identity",
    endingType: "a hard-won reconciliation",
    elements: {
      plot: [],
      setting: [],
      arc: [],
      antagonist: [],
      theme: [],
      stakes: [],
      structure: [],
    },
  });

  assert.match(prompt, /Movie title: "The Stranded Crew"/);
  assert.match(prompt, /large readable poster typography/);
  assert.doesNotMatch(prompt, /no readable typography/);
});
