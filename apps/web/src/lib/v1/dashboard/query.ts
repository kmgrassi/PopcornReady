import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import type {
  AssetKind,
  GenerationRunStatus,
  V1Project,
} from "@popcorn/shared/v1/types";
import {
  v1Api,
  type AssetMediaResponse,
  type ProjectsResponse,
  type WorkspaceAsset,
  type WorkspaceAssetSource,
  type WorkspaceAssetsResponse,
  type WorkspaceOutput,
  type WorkspaceOutputsResponse,
} from "../../api-client";
import { useMeQuery } from "../../queryClient";

type PageCursor = string | null;

// "mine" lists the caller's own workspace; "public" lists everyone's public
// projects/assets via the discovery endpoints.
export type LibraryScope = "mine" | "public";

export const dashboardCollectionQueryKeys = {
  projects: (workspaceId: string, limit: number, scope: LibraryScope) =>
    ["dashboard", "projects", workspaceId, { limit, scope }] as const,
  runs: (
    workspaceId: string,
    filters: {
      status: GenerationRunStatus | "all";
      projectId?: string;
      limit: number;
    },
  ) =>
    [
      "dashboard",
      "generation-runs",
      workspaceId,
      {
        status: filters.status,
        projectId: filters.projectId ?? null,
        limit: filters.limit,
      },
    ] as const,
  assets: (
    workspaceId: string,
    filters: {
      kind: AssetKind | "all";
      source: WorkspaceAssetSource | "all";
      limit: number;
      scope: LibraryScope;
    },
  ) =>
    [
      "dashboard",
      "assets",
      workspaceId,
      {
        kind: filters.kind,
        source: filters.source,
        limit: filters.limit,
        scope: filters.scope,
      },
    ] as const,
  outputs: (
    workspaceId: string,
    filters: {
      projectId?: string;
      limit: number;
    },
  ) =>
    [
      "dashboard",
      "outputs",
      workspaceId,
      {
        projectId: filters.projectId ?? null,
        limit: filters.limit,
      },
    ] as const,
};

function assetKey(asset: WorkspaceAsset): string {
  return asset.assetId ?? asset.id;
}

function updateAssetPages(
  data: InfiniteData<WorkspaceAssetsResponse, PageCursor> | undefined,
  assetId: string,
  update: (asset: WorkspaceAsset) => WorkspaceAsset,
): InfiniteData<WorkspaceAssetsResponse, PageCursor> | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      assets: page.assets.map((asset) =>
        assetKey(asset) === assetId ? update(asset) : asset,
      ),
    })),
  };
}

function updateMatchingAssetQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  assetId: string,
  update: (asset: WorkspaceAsset) => WorkspaceAsset,
) {
  queryClient.setQueriesData<InfiniteData<WorkspaceAssetsResponse, PageCursor>>(
    { queryKey: ["dashboard", "assets", workspaceId] },
    (current) => updateAssetPages(current, assetId, update),
  );
}

function flattenPages<TPage, TItem>(
  pages: TPage[] | undefined,
  selectItems: (page: TPage) => TItem[],
): TItem[] {
  return pages?.flatMap(selectItems) ?? [];
}

export function useDashboardRunsQuery(
  authScope: string,
  filters: {
    status: GenerationRunStatus | "all";
    projectId?: string;
    limit: number;
  },
) {
  const meQuery = useMeQuery(authScope);
  const workspaceId = meQuery.data?.workspaceId ?? "pending";
  const query = useInfiniteQuery({
    queryKey: dashboardCollectionQueryKeys.runs(workspaceId, filters),
    enabled: Boolean(meQuery.data),
    initialPageParam: null as PageCursor,
    queryFn: ({ pageParam, signal }) =>
      v1Api.listWorkspaceGenerationRuns(
        meQuery.data!.workspaceId,
        {
          status: filters.status,
          projectId: filters.projectId,
          limit: filters.limit,
          cursor: pageParam,
        },
        signal,
      ),
    getNextPageParam: (lastPage) => lastPage.pagination.nextCursor,
  });

  return {
    items: flattenPages(query.data?.pages, (page) => page.runs),
    error: meQuery.error ?? query.error ?? null,
    loading: meQuery.isLoading || query.isLoading,
    loadingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: () => {
      void meQuery.refetch();
      void query.refetch();
    },
  };
}

export function useDashboardProjectsQuery(
  authScope: string,
  limit: number,
  scope: LibraryScope = "mine",
) {
  const meQuery = useMeQuery(authScope);
  const isPublic = scope === "public";
  // Exclude the caller's OWN public projects from the public feed — they open
  // read-only there and are edited from "My library" instead. Undefined until
  // the workspace resolves (then the key changes and the feed refetches).
  const excludeWorkspaceId = isPublic ? meQuery.data?.workspaceId : undefined;
  // Public lists don't depend on a workspace for tenancy, but they key on the
  // excluded workspace so the self-exclusion applies once it's known.
  const keyWorkspace = isPublic
    ? `public:${excludeWorkspaceId ?? "all"}`
    : (meQuery.data?.workspaceId ?? "pending");
  const query = useInfiniteQuery({
    queryKey: dashboardCollectionQueryKeys.projects(keyWorkspace, limit, scope),
    enabled: isPublic ? true : Boolean(meQuery.data),
    initialPageParam: null as PageCursor,
    queryFn: ({ pageParam }) =>
      isPublic
        ? v1Api.listPublicProjects({
            limit,
            cursor: pageParam,
            ...(excludeWorkspaceId ? { excludeWorkspaceId } : {}),
          })
        : v1Api.listProjects({ limit, cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.pagination.nextCursor,
  });

  return {
    items: flattenPages<ProjectsResponse, V1Project>(
      query.data?.pages,
      (page) => page.projects,
    ),
    error: (isPublic ? null : meQuery.error) ?? query.error ?? null,
    loading: (isPublic ? false : meQuery.isLoading) || query.isLoading,
    loadingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: () => {
      if (!isPublic) void meQuery.refetch();
      void query.refetch();
    },
  };
}

export function useDashboardAssetsQuery(
  authScope: string,
  filters: {
    kind: AssetKind | "all";
    source: WorkspaceAssetSource | "all";
    limit: number;
  },
  scope: LibraryScope = "mine",
) {
  const meQuery = useMeQuery(authScope);
  const isPublic = scope === "public";
  const keyWorkspace = isPublic ? "public" : (meQuery.data?.workspaceId ?? "pending");
  const queryKey = dashboardCollectionQueryKeys.assets(keyWorkspace, { ...filters, scope });
  const query = useInfiniteQuery({
    queryKey,
    enabled: isPublic ? true : Boolean(meQuery.data),
    initialPageParam: null as PageCursor,
    queryFn: ({ pageParam, signal }) =>
      isPublic
        ? v1Api.listPublicAssets(
            { kind: filters.kind, limit: filters.limit, cursor: pageParam },
            signal,
          )
        : v1Api.listWorkspaceAssets(
            meQuery.data!.workspaceId,
            {
              kind: filters.kind,
              source: filters.source,
              limit: filters.limit,
              cursor: pageParam,
            },
            signal,
          ),
    getNextPageParam: (lastPage) => lastPage.pagination.nextCursor,
  });

  return {
    items: flattenPages(query.data?.pages, (page) => page.assets),
    error: (isPublic ? null : meQuery.error) ?? query.error ?? null,
    loading: (isPublic ? false : meQuery.isLoading) || query.isLoading,
    loadingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    queryKey,
    refetch: () => {
      if (!isPublic) void meQuery.refetch();
      void query.refetch();
    },
  };
}

export function useDashboardOutputsQuery(
  authScope: string,
  limitOrFilters:
    | number
    | {
        projectId?: string;
        limit: number;
      },
) {
  const filters =
    typeof limitOrFilters === "number"
      ? { limit: limitOrFilters }
      : limitOrFilters;
  const meQuery = useMeQuery(authScope);
  const workspaceId = meQuery.data?.workspaceId ?? "pending";
  const query = useInfiniteQuery({
    queryKey: dashboardCollectionQueryKeys.outputs(workspaceId, filters),
    enabled: Boolean(meQuery.data),
    initialPageParam: null as PageCursor,
    queryFn: ({ pageParam, signal }) =>
      v1Api.listWorkspaceOutputs(
        meQuery.data!.workspaceId,
        { projectId: filters.projectId, limit: filters.limit, cursor: pageParam },
        signal,
      ),
    getNextPageParam: (lastPage) => lastPage.pagination.nextCursor,
  });

  return {
    items: flattenPages<WorkspaceOutputsResponse, WorkspaceOutput>(
      query.data?.pages,
      (page) => page.outputs,
    ),
    error: meQuery.error ?? query.error ?? null,
    loading: meQuery.isLoading || query.isLoading,
    loadingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: () => {
      void meQuery.refetch();
      void query.refetch();
    },
  };
}

export function useAssetVisibilityMutation(
  authScope: string,
  filters: {
    kind: AssetKind | "all";
    source: WorkspaceAssetSource | "all";
    limit: number;
  },
) {
  const queryClient = useQueryClient();
  const meQuery = useMeQuery(authScope);

  return useMutation({
    mutationFn: ({
      asset,
      visibility,
    }: {
      asset: WorkspaceAsset;
      visibility: "public" | "private";
    }) => v1Api.setAssetVisibility(asset.projectId, assetKey(asset), visibility),
    onMutate: async ({ asset, visibility }) => {
      const workspaceId = meQuery.data?.workspaceId;
      if (!workspaceId) return {};
      const id = assetKey(asset);
      const previousVisibility: "public" | "private" =
        asset.visibility === "private" ? "private" : "public";
      await queryClient.cancelQueries({
        queryKey: ["dashboard", "assets", workspaceId],
      });
      updateMatchingAssetQueries(queryClient, workspaceId, id, (item) => ({
        ...item,
        visibility,
      }));
      return { assetId: id, previousVisibility, workspaceId };
    },
    onError: (_error, _variables, context) => {
      if (!context?.workspaceId) return;
      updateMatchingAssetQueries(
        queryClient,
        context.workspaceId,
        context.assetId,
        (item) => ({
          ...item,
          visibility: context.previousVisibility,
        }),
      );
    },
    onSuccess: (payload, { asset, visibility }) => {
      const workspaceId = meQuery.data?.workspaceId;
      if (!workspaceId) return;
      updateMatchingAssetQueries(
        queryClient,
        workspaceId,
        assetKey(asset),
        (item) => ({
          ...item,
          visibility: payload.asset.visibility ?? visibility,
        }),
      );
      void queryClient.invalidateQueries({
        queryKey: ["dashboard", "assets", workspaceId],
      });
    },
  });
}

export function useAssetMediaMutation(
  authScope: string,
  filters: {
    kind: AssetKind | "all";
    source: WorkspaceAssetSource | "all";
    limit: number;
  },
) {
  const queryClient = useQueryClient();
  const meQuery = useMeQuery(authScope);
  const queryKey = meQuery.data
    ? dashboardCollectionQueryKeys.assets(meQuery.data.workspaceId, {
        ...filters,
        scope: "mine",
      })
    : null;

  return useMutation({
    mutationFn: (assetId: string) => v1Api.refreshAssetMedia(assetId),
    onSuccess: (media: AssetMediaResponse, assetId) => {
      if (!queryKey) return;
      queryClient.setQueryData<
        InfiniteData<WorkspaceAssetsResponse, PageCursor>
      >(queryKey, (current) =>
        updateAssetPages(current, assetId, (asset) => ({
          ...asset,
          url: media.url ?? undefined,
          thumbnailUrl: media.thumbnailUrl ?? undefined,
        })),
      );
    },
  });
}

export function useAssetRegenerateMutation(
  authScope: string,
  filters: {
    kind: AssetKind | "all";
    source: WorkspaceAssetSource | "all";
    limit: number;
  },
) {
  const queryClient = useQueryClient();
  const meQuery = useMeQuery(authScope);
  const queryKey = meQuery.data
    ? dashboardCollectionQueryKeys.assets(meQuery.data.workspaceId, {
        ...filters,
        scope: "mine",
      })
    : null;

  return useMutation({
    mutationFn: ({ assetId, prompt }: { assetId: string; prompt?: string }) =>
      v1Api.regenerateAsset(assetId, prompt),
    onSuccess: (media: AssetMediaResponse, { assetId }) => {
      if (!queryKey) return;
      queryClient.setQueryData<
        InfiniteData<WorkspaceAssetsResponse, PageCursor>
      >(queryKey, (current) =>
        updateAssetPages(current, assetId, (asset) => ({
          ...asset,
          status: "ready",
          url: media.url ?? undefined,
          thumbnailUrl: media.thumbnailUrl ?? undefined,
        })),
      );
    },
  });
}
