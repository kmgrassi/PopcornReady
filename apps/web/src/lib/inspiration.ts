import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "./api-client";

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

export interface RandomStoryInspiration {
  formula: string;
  logline: string;
  typeOfPerson: string;
  setting: string;
  externalGoal: string;
  antagonisticForce: string;
  innerFlawOrLie: string;
  oldSelf: string;
  newTruth: string;
  endingType: string;
  elements: {
    plot: InspirationElement[];
    setting: InspirationElement[];
    arc: InspirationElement[];
    antagonist: InspirationElement[];
    theme: InspirationElement[];
    stakes: InspirationElement[];
    structure: InspirationElement[];
  };
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
  });
}

export function useStoryConceptPosterMutation() {
  return useMutation({
    mutationFn: (inspiration: RandomStoryInspiration) =>
      apiRequest<{ poster: StoryConceptPoster }>("/api/v1/inspiration/poster", {
        method: "POST",
        body: { inspiration },
      }),
  });
}
