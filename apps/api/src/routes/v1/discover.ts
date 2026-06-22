import { Router, type RequestHandler } from "express";
import { ApiError } from "@/core/errors";
import {
  parseDiscoverAssetsQuery,
  parseDiscoverSearchQuery,
  parsePagination,
} from "@/lib/api/v1/schemas";
import {
  getPublicProjectBundle,
  listPublicAssets,
  listPublicProjects,
} from "@/lib/api/v1/store";
import { searchPublicDiscovery } from "@/lib/api/v1/asset-embedding-search";

export const discoverRouter = Router();

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Optional, caller-supplied workspace id to exclude from the public feed (the
// signed-in viewer's own workspace). Ignore anything not uuid-shaped so a bad
// value can't reach Postgres as a malformed filter.
function optionalWorkspaceId(value: string | null): string | undefined {
  return value && UUID_RE.test(value) ? value : undefined;
}

discoverRouter.get(
  "/discover/projects",
  publicRoute(async (req) => {
    const params = searchParamsFor(req);
    const { limit, cursor } = parsePagination(params);
    const excludeWorkspaceId = optionalWorkspaceId(params.get("excludeWorkspaceId"));
    const { items, nextCursor } = await listPublicProjects(limit, cursor, {
      ...(excludeWorkspaceId ? { excludeWorkspaceId } : {}),
    });
    return {
      status: 200,
      body: { projects: items, pagination: { limit, nextCursor } },
    };
  })
);

discoverRouter.get(
  "/discover/projects/:projectId",
  publicRoute(async (req) => {
    const projectId = req.params.projectId;
    if (!projectId) {
      throw new ApiError("validation_failed", "projectId is required.");
    }
    const bundle = await getPublicProjectBundle(projectId);
    if (!bundle) {
      throw new ApiError("not_found", "Public project not found.");
    }
    return { status: 200, body: bundle };
  })
);

discoverRouter.get(
  "/discover/assets",
  publicRoute(async (req) => {
    const { limit, cursor, kind } = parseDiscoverAssetsQuery(searchParamsFor(req));
    const { items, nextCursor } = await listPublicAssets(limit, cursor, kind);
    return {
      status: 200,
      body: { assets: items, pagination: { limit, nextCursor } },
    };
  })
);

discoverRouter.get(
  "/discover/search",
  publicRoute(async (req) => {
    const { q, limit, cursor, kind, semantic } = parseDiscoverSearchQuery(
      searchParamsFor(req)
    );
    const { items, nextCursor } = await searchPublicDiscovery({
      query: q,
      limit,
      cursor,
      kind,
      semantic,
    });
    return {
      status: 200,
      body: { results: items, pagination: { limit, nextCursor } },
    };
  })
);
