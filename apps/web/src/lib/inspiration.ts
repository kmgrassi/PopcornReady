import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "./api-client";
import {
  EMPTY_BRIEF_DRAFT,
  type BriefDraft,
} from "../components/studio/useStudioFlow";
import { createAndStartRun, type StartRunResult } from "./startRun";

export type StoryElementCategory =
  | "plot_type"
  | "setting"
  | "character_arc"
  | "belief_shift"
  | "structure"
  | "antagonist_type"
  | "stakes"
  | "theme";

export interface InspirationElement {
  id: string;
  category: StoryElementCategory;
  groupSlug: string | null;
  slug: string;
  name: string;
  coreIdea: string | null;
}

export type InspirationIngredientGroup =
  | "plot"
  | "setting"
  | "arc"
  | "antagonist"
  | "theme"
  | "stakes"
  | "structure";

export interface InspirationIngredientSummary {
  emoji: string;
  summary: string;
}

export interface RandomStoryInspiration {
  movieTitle: string;
  logline: string;
  premise: string;
  // Opaque server signature; echoed back to /poster so it only generates
  // posters for concepts the server authored. Not rendered.
  signature: string;
  ingredients: Record<InspirationIngredientGroup, InspirationIngredientSummary>;
  elements: Record<InspirationIngredientGroup, InspirationElement[]>;
  poster?: StoryConceptPoster;
}

export interface StoryConceptPoster {
  status: "queued" | "generating" | "ready" | "failed";
  url: string | null;
  assetId: string | null;
  prompt: string;
}

interface RandomStoryInspirationResponse {
  inspiration: RandomStoryInspiration;
}

interface StoryConceptPosterResponse {
  movieTitle: string;
  poster: StoryConceptPoster;
}

export const inspirationQueryKeys = {
  random: (nonce: number) => ["inspiration", "random", nonce] as const,
};

export function useRandomStoryInspiration(nonce: number) {
  return useQuery({
    queryKey: inspirationQueryKeys.random(nonce),
    queryFn: ({ signal }) =>
      apiRequest<RandomStoryInspirationResponse>("/api/v1/inspiration/random", {
        signal,
      }),
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useStoryConceptPosterMutation() {
  return useMutation({
    mutationFn: (inspiration: RandomStoryInspiration) =>
      apiRequest<StoryConceptPosterResponse>("/api/v1/inspiration/poster", {
        method: "POST",
        body: { inspiration },
      }),
  });
}

const INGREDIENT_PROMPT_LABELS: Record<InspirationIngredientGroup, string> = {
  plot: "Plot",
  setting: "Setting",
  arc: "Character arc",
  antagonist: "Antagonist",
  theme: "Theme",
  stakes: "Stakes",
  structure: "Structure",
};

export function inspirationPrompt(inspiration: RandomStoryInspiration): string {
  const ingredientLines = (
    Object.keys(INGREDIENT_PROMPT_LABELS) as InspirationIngredientGroup[]
  ).map((group) => {
    const names = inspiration.elements[group].map((element) => element.name).join(", ");
    return `${INGREDIENT_PROMPT_LABELS[group]}: ${names}`;
  });
  return [
    "Develop this authored movie concept into a 30-second storyboard. Keep the logline and premise as the source of truth; the ingredient list is background inspiration, not a checklist of required literal beats.",
    "",
    inspiration.logline,
    "",
    inspiration.premise,
    "",
    "Background ingredients to use only where they strengthen the concept:",
    ...ingredientLines,
  ].join("\n");
}

function buildInspirationDraft(inspiration: RandomStoryInspiration): BriefDraft {
  return {
    ...EMPTY_BRIEF_DRAFT,
    goal: inspirationPrompt(inspiration),
    projectName: (inspiration.movieTitle || inspiration.logline).slice(0, 96),
    targetLengthSec: 30,
    footageChoice: "prompt_only",
    reviewGates: ["brief_intake"],
  };
}

export function startInspirationStoryboardRun(
  inspiration: RandomStoryInspiration,
): Promise<StartRunResult> {
  return createAndStartRun(buildInspirationDraft(inspiration), {
    stopAfter: "storyboard",
  });
}

export function useStartInspirationStoryboardRunMutation() {
  return useMutation({
    mutationFn: startInspirationStoryboardRun,
  });
}
