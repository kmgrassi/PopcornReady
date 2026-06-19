import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { V1Project } from "@popcorn/shared/v1/types";
import { apiRequest, v1Api } from "./api-client";

export type CatalogEntryKind = "character" | "story" | "image";
export type CatalogEntryStatus = "draft" | "published" | "archived";

export interface CatalogEntrySnapshot {
  searchText?: string;
  logline?: string;
  title?: string;
  description?: string;
  dimensions?: {
    width?: number;
    height?: number;
  };
  story?: {
    logline?: string;
    characters?: Array<{
      id?: string;
      name?: string;
      role?: string;
      description?: string;
    }>;
    acts?: Array<{
      id?: string;
      title?: string;
      purpose?: string;
      summary?: string;
      targetDurationSec?: number;
    }>;
    scenes?: Array<{
      id?: string;
      title?: string;
      summary?: string;
      setting?: string;
      targetDurationSec?: number;
    }>;
  };
  characters?: Array<{
    id?: string;
    name?: string;
    description?: string;
  }>;
  acts?: Array<{
    id?: string;
    title?: string;
    summary?: string;
  }>;
  scenes?: Array<{
    id?: string;
    title?: string;
    summary?: string;
    setting?: string;
  }>;
}

export interface CatalogEntry {
  id: string;
  schemaVersion?: string;
  kind: CatalogEntryKind;
  status: CatalogEntryStatus;
  publisherUserId?: string;
  sourceWorkspaceId?: string | null;
  sourceProjectId?: string | null;
  sourceAssetId?: string | null;
  sourceStoryBlueprintId?: string | null;
  title: string;
  summary?: string | null;
  tags: string[];
  previewUrl?: string | null;
  previewStorageKey?: string | null;
  previewStorageBucket?: string | null;
  previewContentType?: string | null;
  snapshot?: CatalogEntrySnapshot;
  useCount: number;
  likeCount: number;
  viewerHasLiked?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogEntriesResponse {
  entries: CatalogEntry[];
  pagination: {
    limit: number;
    nextCursor: string | null;
  };
}

interface CatalogSearchResponse {
  results: CatalogEntry[];
  pagination: {
    limit: number;
    nextCursor: string | null;
  };
}

export interface CatalogMineResponse {
  entries: CatalogEntry[];
  pagination?: {
    limit: number;
    nextCursor: string | null;
  };
}

export interface CatalogEntryResponse {
  entry: CatalogEntry;
}

export interface CatalogLikesResponse {
  likedEntryIds: string[];
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
  all: ["catalog"] as const,
  entries: (filters: {
    kind?: CatalogEntryKind | "all";
    q?: string;
    limit: number;
  }) =>
    [
      "catalog",
      "entries",
      {
        kind: filters.kind ?? "all",
        q: filters.q?.trim() ?? "",
        limit: filters.limit,
      },
    ] as const,
  entry: (entryId: string) => ["catalog", "entry", entryId] as const,
  likes: (entryIds: string[]) =>
    ["catalog", "likes", Array.from(new Set(entryIds)).sort()] as const,
  projects: ["catalog", "projects"] as const,
};

function catalogPath(suffix: string): string {
  return `/api/v1/catalog${suffix}`;
}

export const catalogApi = {
  listEntries: (
    params: {
      kind?: CatalogEntryKind | "all";
      limit?: number;
      cursor?: string | null;
    } = {},
    signal?: AbortSignal,
  ) =>
    apiRequest<CatalogEntriesResponse>(catalogPath("/entries"), {
      signal,
      searchParams: {
        ...params,
        kind: params.kind === "all" ? undefined : params.kind,
      },
    }),

  searchEntries: async (
    params: {
      q: string;
      kind?: CatalogEntryKind | "all";
      limit?: number;
      cursor?: string | null;
    },
    signal?: AbortSignal,
  ): Promise<CatalogEntriesResponse> => {
    const response = await apiRequest<CatalogSearchResponse>(catalogPath("/search"), {
      signal,
      searchParams: {
        ...params,
        kind: params.kind === "all" ? undefined : params.kind,
      },
    });
    return {
      entries: response.results,
      pagination: response.pagination,
    };
  },

  getEntry: (entryId: string, signal?: AbortSignal) =>
    apiRequest<CatalogEntryResponse>(
      catalogPath(`/entries/${encodeURIComponent(entryId)}`),
      { signal },
    ),

  listMine: (params: { limit?: number; cursor?: string | null } = {}, signal?: AbortSignal) =>
    apiRequest<CatalogMineResponse>(catalogPath("/mine"), {
      signal,
      searchParams: params,
    }),

  listLikedEntryIds: (entryIds: string[], signal?: AbortSignal) =>
    apiRequest<CatalogLikesResponse>(catalogPath("/likes"), {
      signal,
      searchParams: { entryIds: Array.from(new Set(entryIds)).join(",") },
    }),

  likeEntry: (entryId: string) =>
    apiRequest<CatalogEntryResponse>(
      catalogPath(`/entries/${encodeURIComponent(entryId)}/like`),
      { method: "POST" },
    ),

  unlikeEntry: (entryId: string) =>
    apiRequest<CatalogEntryResponse>(
      catalogPath(`/entries/${encodeURIComponent(entryId)}/like`),
      { method: "DELETE" },
    ),
};

export function useCatalogEntriesQuery(filters: {
  kind?: CatalogEntryKind | "all";
  q?: string;
  limit: number;
}) {
  const normalizedQuery = filters.q?.trim() ?? "";

  return useInfiniteQuery({
    queryKey: catalogQueryKeys.entries({
      ...filters,
      q: normalizedQuery,
    }),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      normalizedQuery
        ? catalogApi.searchEntries(
            {
              q: normalizedQuery,
              kind: filters.kind,
              limit: filters.limit,
              cursor: pageParam,
            },
            signal,
          )
        : catalogApi.listEntries(
            {
              kind: filters.kind,
              limit: filters.limit,
              cursor: pageParam,
            },
            signal,
          ),
    getNextPageParam: (lastPage) => lastPage.pagination.nextCursor,
  });
}

export function useCatalogEntryQuery(entryId: string) {
  return useQuery({
    queryKey: catalogQueryKeys.entry(entryId),
    queryFn: ({ signal }) => catalogApi.getEntry(entryId, signal),
    enabled: Boolean(entryId),
  });
}

export function useCatalogLikesQuery(entryIds: string[]) {
  const normalizedIds = Array.from(new Set(entryIds)).filter(Boolean).sort();
  return useQuery({
    queryKey: catalogQueryKeys.likes(normalizedIds),
    queryFn: ({ signal }) => catalogApi.listLikedEntryIds(normalizedIds, signal),
    enabled: normalizedIds.length > 0,
    staleTime: 30_000,
  });
}

export function useCatalogLikeMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { entryId: string; shouldLike: boolean }) =>
      input.shouldLike
        ? catalogApi.likeEntry(input.entryId)
        : catalogApi.unlikeEntry(input.entryId),
    onSuccess: (response) => {
      queryClient.setQueryData<CatalogEntryResponse>(
        catalogQueryKeys.entry(response.entry.id),
        response,
      );
      void queryClient.invalidateQueries({ queryKey: catalogQueryKeys.all });
    },
  });
}

export function useCatalogProjectPickerQuery(limit = 100) {
  return useQuery({
    queryKey: catalogQueryKeys.projects,
    queryFn: () => v1Api.listProjects({ limit }),
  });
}
