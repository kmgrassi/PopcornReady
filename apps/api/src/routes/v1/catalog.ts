import { Router, type RequestHandler } from "express";
import { mutation, route } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import {
  archiveCatalogEntry,
  getCatalogEntry,
  likeCatalogEntry,
  listCatalogEntries,
  listLikedCatalogEntryIds,
  listMyCatalogEntries,
  publishCatalogEntry,
  publisherUserIdForWorkspace,
  searchCatalogEntries,
  unlikeCatalogEntry,
  updateCatalogEntry,
  useCatalogEntry,
} from "@/lib/api/v1/catalog";
import {
  parseCatalogEntriesQuery,
  parseCatalogSearchQuery,
  parsePagination,
  parsePublishCatalogEntry,
  parseUpdateCatalogEntry,
  parseUseCatalogEntry,
} from "@/lib/api/v1/schemas";
import { getServiceSupabase } from "@/lib/supabase/clients";

export const catalogPublicRouter = Router();
export const catalogProtectedRouter = Router();

function requiredParam(params: Record<string, string | undefined>, name: string): string {
  const value = params[name];
  if (!value) {
    throw new ApiError("validation_failed", `${name} is required.`);
  }
  return value;
}

function publicRoute(
  fn: (req: Parameters<RequestHandler>[0]) => Promise<{ status: number; body: unknown }>
): RequestHandler {
  return async (req, res) => {
    try {
      const result = await fn(req);
      res.status(result.status).json(result.body);
    } catch (err) {
      const apiError =
        err instanceof ApiError
          ? err
          : new ApiError(
              "internal_error",
              err instanceof Error ? err.message : "Internal error."
            );
      res.status(apiError.status).json(apiError.envelope(req.requestId));
    }
  };
}

function searchParamsFor(req: Parameters<RequestHandler>[0]): URLSearchParams {
  return new URL(req.originalUrl, "http://localhost").searchParams;
}

function parseEntryIdsParam(searchParams: URLSearchParams): string[] {
  const rawValues = searchParams.getAll("entryIds");
  const values = rawValues.length ? rawValues : [searchParams.get("entryIds") ?? ""];
  const entryIds = Array.from(
    new Set(
      values
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
  if (entryIds.length > 100) {
    throw new ApiError(
      "validation_failed",
      "entryIds accepts at most 100 IDs per request."
    );
  }
  return entryIds;
}

catalogPublicRouter.get(
  "/catalog/entries",
  publicRoute(async (req) => {
    const query = parseCatalogEntriesQuery(searchParamsFor(req));
    const { items, nextCursor } = await listCatalogEntries(query);
    return {
      status: 200,
      body: { entries: items, pagination: { limit: query.limit, nextCursor } },
    };
  })
);

catalogPublicRouter.get(
  "/catalog/search",
  publicRoute(async (req) => {
    const query = parseCatalogSearchQuery(searchParamsFor(req));
    const { items, nextCursor } = await searchCatalogEntries(query);
    return {
      status: 200,
      body: { results: items, pagination: { limit: query.limit, nextCursor } },
    };
  })
);

catalogPublicRouter.get(
  "/catalog/entries/:id",
  publicRoute(async (req) => {
    const entry = await getCatalogEntry(requiredParam(req.params, "id"));
    return { status: 200, body: { entry } };
  })
);

catalogProtectedRouter.get(
  "/catalog/mine",
  route(async ({ auth, req }) => {
    const query = parsePagination(req.searchParams);
    const publisherUserId = await publisherUserIdForWorkspace(
      getServiceSupabase(),
      auth.workspaceId
    );
    const { items, nextCursor } = await listMyCatalogEntries({
      publisherUserId,
      ...query,
    });
    return {
      status: 200,
      body: { entries: items, pagination: { limit: query.limit, nextCursor } },
    };
  })
);

catalogProtectedRouter.get(
  "/catalog/likes",
  route(async ({ auth, req }) => {
    const userId = await publisherUserIdForWorkspace(getServiceSupabase(), auth.workspaceId);
    const likedEntryIds = await listLikedCatalogEntryIds({
      userId,
      entryIds: parseEntryIdsParam(req.searchParams),
    });
    return { status: 200, body: { likedEntryIds } };
  })
);

catalogProtectedRouter.post(
  "/catalog/entries",
  mutation(async ({ auth, body }) => {
    const input = parsePublishCatalogEntry(body);
    const entry = await publishCatalogEntry({
      authWorkspaceId: auth.workspaceId,
      body: input,
    });
    return { status: 201, body: { entry } };
  })
);

catalogProtectedRouter.patch(
  "/catalog/entries/:id",
  mutation(async ({ auth, body }, params) => {
    const publisherUserId = await publisherUserIdForWorkspace(
      getServiceSupabase(),
      auth.workspaceId
    );
    const entry = await updateCatalogEntry({
      entryId: requiredParam(params, "id"),
      publisherUserId,
      body: parseUpdateCatalogEntry(body),
    });
    return { status: 200, body: { entry } };
  })
);

catalogProtectedRouter.delete(
  "/catalog/entries/:id",
  mutation(async ({ auth }, params) => {
    const publisherUserId = await publisherUserIdForWorkspace(
      getServiceSupabase(),
      auth.workspaceId
    );
    const entry = await archiveCatalogEntry({
      entryId: requiredParam(params, "id"),
      publisherUserId,
    });
    return { status: 200, body: { entry } };
  })
);

catalogProtectedRouter.post(
  "/catalog/entries/:id/use",
  mutation(async ({ auth, body }, params) => {
    const result = await useCatalogEntry({
      authWorkspaceId: auth.workspaceId,
      entryId: requiredParam(params, "id"),
      body: parseUseCatalogEntry(body),
    });
    return { status: 201, body: result };
  })
);

catalogProtectedRouter.post(
  "/catalog/entries/:id/like",
  mutation(async ({ auth }, params) => {
    const userId = await publisherUserIdForWorkspace(getServiceSupabase(), auth.workspaceId);
    const entry = await likeCatalogEntry({
      entryId: requiredParam(params, "id"),
      userId,
    });
    return { status: 200, body: { entry } };
  })
);

catalogProtectedRouter.delete(
  "/catalog/entries/:id/like",
  mutation(async ({ auth }, params) => {
    const userId = await publisherUserIdForWorkspace(getServiceSupabase(), auth.workspaceId);
    const entry = await unlikeCatalogEntry({
      entryId: requiredParam(params, "id"),
      userId,
    });
    return { status: 200, body: { entry } };
  })
);
