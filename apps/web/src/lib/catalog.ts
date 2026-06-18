import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "./api-client";

export type CatalogEntryKind = "character" | "story" | "image";
export type CatalogEntryStatus = "draft" | "published" | "archived";

export interface CatalogEntry {
  id: string;
  kind: CatalogEntryKind;
  status: CatalogEntryStatus;
  title: string;
  summary?: string | null;
  tags: string[];
  previewUrl?: string | null;
  snapshot?: Record<string, unknown>;
  useCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogMineResponse {
  entries: CatalogEntry[];
  pagination?: {
    limit: number;
    nextCursor: string | null;
  };
}

export interface PublishCatalogEntryInput {
  kind: CatalogEntryKind;
  sourceAssetId?: string;
  sourceStoryBlueprintId?: string;
  title: string;
  summary?: string;
  tags?: string[];
}

export interface PublishCatalogEntryResponse {
  entry: CatalogEntry;
}

export const catalogQueryKeys = {
  mine: () => ["catalog", "mine"] as const,
};

export const catalogApi = {
  mine: (signal?: AbortSignal) =>
    apiRequest<CatalogMineResponse>("/api/v1/catalog/mine", { signal }),
  publish: (input: PublishCatalogEntryInput) =>
    apiRequest<PublishCatalogEntryResponse>("/api/v1/catalog/entries", {
      method: "POST",
      body: input,
    }),
};

export function useCatalogMineQuery() {
  return useQuery({
    queryKey: catalogQueryKeys.mine(),
    queryFn: ({ signal }) => catalogApi.mine(signal),
  });
}

export function usePublishCatalogEntryMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: PublishCatalogEntryInput) => catalogApi.publish(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: catalogQueryKeys.mine() });
      void queryClient.invalidateQueries({ queryKey: ["catalog", "entries"] });
    },
  });
}
