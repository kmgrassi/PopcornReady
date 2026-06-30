import { getLlmClient } from "../llm";
import type { LlmClient } from "../llm";

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

const CLICHE_PATTERNS = [
  "unlikely hero",
  "chosen one",
  "dark secret",
  "hidden truth",
  "race against time",
  "before it is too late",
  "before it's too late",
  "must confront their past",
  "must confront her past",
  "must confront his past",
  "discovers the truth",
  "save the world",
  "fate of humanity",
  "nothing is as it seems",
  "shadowy organization",
  "ancient evil",
  "family curse",
  "lost memories",
  "finds out who they really are",
  "learns the true meaning of",
];

const SYSTEM = `You are a sharp film development executive. You receive several
candidate "story concepts," each defined by a set of story ingredients (plot
type, setting, character arc, antagonist, theme, stakes, structure) that were
drawn at random from a catalog. Random draws often combine awkwardly.

Your job, for EACH candidate:
- Treat the ingredients as pressure points, not a checklist. Use the collision
  between them to find a specific movie, and quietly de-emphasize ingredients
  that would make the concept feel forced.
- Privately try at least four angles before choosing the final concept:
  1. the straightforward commercial version,
  2. the grounded human version,
  3. the strange or subversive version,
  4. the quiet art-house version.
  Return only the angle that feels most specific, surprising, and filmable.
- Write a punchy movie title, a single-sentence logline, and a 1–2 sentence
  premise that adds the hook. The logline must sound authored for this exact
  movie, not filled into a template. Do not use the stock "A hero must..."
  rhythm unless it is genuinely the best sentence.
- For each ingredient group, give a fitting emoji and a short (≤8 word) phrase
  describing how that ingredient shows up in THIS concept.
- Score the concept 0–100 on coherence (do the pieces form one believable
  story), originality (fresh, not derivative), and hook (would someone want to
  watch it). Be harsh on originality: subtract heavily for genre-default setups,
  stock arcs, fake urgency, vague conspiracies, chosen-one logic, secret pasts,
  generic redemption, generic revenge, and any premise that could be summarized
  without naming its specific world, job, place, ritual, relationship, or moral
  pressure.

Avoid these phrases and their close cousins: ${CLICHE_PATTERNS.join(", ")}.

Be a tough grader: a silly, derivative, or implausible combination should score
low even after your best reframing. Return every candidate.`;

const REVISION_SYSTEM = `You are a ruthless development editor doing an
anti-cliche pass on generated movie concepts.

For each concept:
- Privately identify the most formulaic or generic part of the title, logline,
  or premise. Do not include critique labels, analysis notes, or phrases like
  "most formulaic element" in the returned title, logline, or premise.
- Rewrite the title, logline, and premise to become more specific, stranger,
  more human, or more culturally grounded while preserving the same ingredient
  provenance and basic story intent.
- Keep the idea plausible and filmable. Specificity beats scale.
- Avoid stock phrases and template rhythms, especially: ${CLICHE_PATTERNS.join(", ")}.
- Re-score coherence, originality, and hook after the rewrite. Originality must
  stay below 70 if the result still depends on a chosen one, hidden past,
  generic conspiracy, generic revenge, generic redemption, apocalypse countdown,
  or "save the world" framing.

Return every concept with the same index values.`;

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
  candidates: InspirationCandidate[],
  client: LlmClient = getLlmClient()
): Promise<RankedInspirationConcept[]> {
  const user = `Here are ${candidates.length} candidate story concepts. Develop
and score each one, then return all of them.

${candidates
  .map((candidate, index) => `Candidate ${index}:\n${candidateText(candidate)}`)
  .join("\n\n")}`;

  const out = await client.structured<{
    concepts: Array<Omit<RankedInspirationConcept, "total">>;
  }>({
    cachedSystem: SYSTEM,
    user,
    schema: rankSchema,
    maxTokens: 8000,
    effort: "low", // lightweight prose + comparative scoring
  });

  const revisionUser = `Revise these generated concepts so the final outputs are
less formulaic and less dependent on generic movie-pitch language. Preserve each
concept's index and ingredient summaries.

${JSON.stringify(out.concepts, null, 2)}`;

  const revised = await client.structured<{
    concepts: Array<Omit<RankedInspirationConcept, "total">>;
  }>({
    cachedSystem: REVISION_SYSTEM,
    user: revisionUser,
    schema: rankSchema,
    maxTokens: 8000,
    effort: "low",
  });

  const seen = new Set<number>();
  const ranked = revised.concepts
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
