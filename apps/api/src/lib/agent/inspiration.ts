import { getLlmClient } from "../llm";

// The inspiration generator picks story ingredients at random from the catalog,
// then asks the model to turn several candidate ingredient sets into coherent,
// plausible movie concepts and rank them. The schema lives here (co-located with
// its only caller) rather than in the shared agent schemas module.

export const INSPIRATION_INGREDIENT_GROUPS = [
  "plot",
  "setting",
  "arc",
  "antagonist",
  "theme",
  "stakes",
  "structure",
] as const;

export type InspirationIngredientGroup =
  (typeof INSPIRATION_INGREDIENT_GROUPS)[number];

const INGREDIENT_LABELS: Record<InspirationIngredientGroup, string> = {
  plot: "Plot type",
  setting: "Setting",
  arc: "Character arc / belief shift",
  antagonist: "Antagonist",
  theme: "Theme",
  stakes: "Stakes",
  structure: "Structure",
};

export interface InspirationElementBrief {
  name: string;
  coreIdea: string | null;
}

// One candidate = one randomly drawn set of ingredients, grouped by role.
export type InspirationCandidate = Record<
  InspirationIngredientGroup,
  InspirationElementBrief[]
>;

export interface InspirationIngredientSummary {
  emoji: string;
  summary: string;
}

export interface RankedInspirationConcept {
  index: number; // which input candidate this concept was written for
  movieTitle: string;
  logline: string;
  premise: string;
  ingredients: Record<InspirationIngredientGroup, InspirationIngredientSummary>;
  scores: { coherence: number; originality: number; hook: number };
  total: number;
}

const str = { type: "string" } as const;
const score = { type: "number", minimum: 0, maximum: 100 } as const;

const ingredientSummarySchema = {
  type: "object",
  additionalProperties: false,
  properties: { emoji: str, summary: str },
  required: ["emoji", "summary"],
};

const ingredientsSchema = {
  type: "object",
  additionalProperties: false,
  properties: INSPIRATION_INGREDIENT_GROUPS.reduce(
    (acc, group) => {
      acc[group] = ingredientSummarySchema;
      return acc;
    },
    {} as Record<InspirationIngredientGroup, typeof ingredientSummarySchema>
  ),
  required: [...INSPIRATION_INGREDIENT_GROUPS],
};

const conceptSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    index: { type: "number" },
    movieTitle: str,
    logline: str,
    premise: str,
    ingredients: ingredientsSchema,
    scores: {
      type: "object",
      additionalProperties: false,
      properties: { coherence: score, originality: score, hook: score },
      required: ["coherence", "originality", "hook"],
    },
  },
  required: ["index", "movieTitle", "logline", "premise", "ingredients", "scores"],
};

const rankSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    concepts: { type: "array", items: conceptSchema },
  },
  required: ["concepts"],
};

const SYSTEM = `You are a sharp film development executive. You receive several
candidate "story concepts," each defined by a set of story ingredients (plot
type, setting, character arc, antagonist, theme, stakes, structure) that were
drawn at random from a catalog. Random draws often combine awkwardly.

Your job, for EACH candidate:
- Turn the ingredients into ONE coherent, genuinely interesting, PLAUSIBLE movie
  concept a real audience could believe in. Make the pieces fit together; lean
  into the strongest tension and quietly de-emphasize any ingredient that fights
  the others rather than forcing every literal element in.
- Write a punchy movie title, a single-sentence logline (the classic
  "A [hero] must [goal] before [stakes], but [obstacle]" shape — concrete, no
  jargon), and a 1–2 sentence premise that adds the hook.
- For each ingredient group, give a fitting emoji and a short (≤8 word) phrase
  describing how that ingredient shows up in THIS concept.
- Score the concept 0–100 on coherence (do the pieces form one believable
  story), originality (fresh, not derivative), and hook (would someone want to
  watch it).

Be a tough grader: a silly or implausible combination should score low on
coherence even after your best reframing. Return every candidate.`;

function candidateText(candidate: InspirationCandidate): string {
  return INSPIRATION_INGREDIENT_GROUPS.map((group) => {
    const items = candidate[group]
      .map((el) => (el.coreIdea ? `${el.name} (${el.coreIdea})` : el.name))
      .join("; ");
    return `  - ${INGREDIENT_LABELS[group]}: ${items || "—"}`;
  }).join("\n");
}

/**
 * Generates and ranks one movie concept per candidate ingredient set. The
 * returned list is sorted best-first by total score.
 */
export async function rankStoryConcepts(
  candidates: InspirationCandidate[]
): Promise<RankedInspirationConcept[]> {
  const user = `Here are ${candidates.length} candidate story concepts. Develop
and score each one, then return all of them.

${candidates
  .map((candidate, index) => `Candidate ${index}:\n${candidateText(candidate)}`)
  .join("\n\n")}`;

  const out = await getLlmClient().structured<{
    concepts: Array<Omit<RankedInspirationConcept, "total">>;
  }>({
    cachedSystem: SYSTEM,
    user,
    schema: rankSchema,
    maxTokens: 8000,
    effort: "low", // lightweight prose + comparative scoring
  });

  const seen = new Set<number>();
  const ranked = out.concepts
    .filter((concept) => {
      if (
        !Number.isInteger(concept.index) ||
        concept.index < 0 ||
        concept.index >= candidates.length ||
        seen.has(concept.index)
      ) {
        return false;
      }
      seen.add(concept.index);
      return true;
    })
    .map((concept) => ({
      ...concept,
      total:
        concept.scores.coherence +
        concept.scores.originality +
        concept.scores.hook,
    }))
    .sort((a, b) => b.total - a.total);

  if (!ranked.length) {
    throw new Error("The concept ranker returned no usable concepts.");
  }
  return ranked;
}
