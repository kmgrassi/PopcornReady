import { Router } from "express";
import { mutation, route } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import { authMode, bearerToken } from "@/lib/api/v1/auth";
import type { HandlerCtx } from "@/lib/api/v1/handler";
import {
  parseAnalyzeBatch,
  parseCreateProject,
  parsePagination,
  parseProjectListOrder,
  parseSetProjectVisibility,
} from "@/lib/api/v1/schemas";
import type { CreateProjectInput } from "@/lib/api/v1/schemas";
import {
  analyzeAssetBatch,
  getAssetAnalysisJob,
} from "@/lib/api/v1/asset-analysis";
import {
  createProject,
  deleteProject,
  deletePublicProjectAsAdmin,
  forkPublicProject,
  getProject,
  getActiveProjectScriptDraft,
  getProjectWatchMedia,
  listProjects,
  recordProjectActivity,
  setProjectPoster,
  setProjectVisibility,
} from "@/lib/api/v1/store";
import { buildUserScopedSupabase } from "@/lib/supabase/clients";
import { generatePoster } from "@/lib/api/v1/poster-generation";
import { getStoryboard, putStoryboard } from "@/lib/api/v1/storyboard";
import { requireApprovedScriptForProjectMedia } from "@/lib/api/v1/project-media-boundary";

export const projectsRouter = Router();

export function projectCreationParams(
  workspaceId: string,
  input: CreateProjectInput,
): Parameters<typeof createProject>[0] {
  return {
    workspaceId,
    name: input.name,
    brief: input.brief,
    namingPrompt: input.namingPrompt,
    namingContext: input.namingContext,
  };
}

const ADMIN_ROLES = new Set(["admin", "owner"]);

function claimValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

function hasAdminAppMetadata(appMetadata: Record<string, unknown> | undefined): boolean {
  if (!appMetadata) return false;
  const claims = [
    ...claimValues(appMetadata.role),
    ...claimValues(appMetadata.roles),
    ...claimValues(appMetadata.workspace_role),
  ];
  return claims.some((claim) => ADMIN_ROLES.has(claim.toLowerCase()));
}

async function requireProjectAdmin(ctx: Pick<HandlerCtx, "auth" | "req">): Promise<void> {
  if (authMode() === "local") return;

  const token = bearerToken(ctx.req);
  if (!token) {
    throw new ApiError("forbidden", "Project admin access required.");
  }

  const supabase = buildUserScopedSupabase(token);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user || !hasAdminAppMetadata(data.user.app_metadata)) {
    throw new ApiError("forbidden", "Project admin access required.");
  }
}

projectsRouter.get(
  "/projects",
  route(async ({ auth, req }) => {
    const { limit, cursor } = parsePagination(req.searchParams);
    const order = parseProjectListOrder(req.searchParams);
    const { items, nextCursor } = await listProjects(
      auth.workspaceId,
      limit,
      cursor,
      order
    );
    return {
      status: 200,
      body: { projects: items, pagination: { limit, nextCursor } },
    };
  })
);

projectsRouter.post(
  "/projects",
  mutation(async ({ auth, body }) => {
    const input = parseCreateProject(body);
    const { project, briefVersion } = await createProject(
      projectCreationParams(auth.workspaceId, input),
    );
    return {
      status: 201,
      body: {
        project,
        ...(briefVersion ? { briefVersion } : {}),
      },
    };
  })
);

projectsRouter.get(
  "/projects/:projectId",
  route(async ({ auth }, params) => {
    if (!params.projectId) {
      throw new ApiError("validation_failed", "projectId is required.");
    }
    await recordProjectActivity(auth.workspaceId, params.projectId);
    const project = await getProject(auth.workspaceId, params.projectId);
    return { status: 200, body: { project } };
  })
);

projectsRouter.get(
  "/projects/:projectId/script",
  route(async ({ auth }, params) => {
    if (!params.projectId) {
      throw new ApiError("validation_failed", "projectId is required.");
    }
    await getProject(auth.workspaceId, params.projectId);
    const script = await getActiveProjectScriptDraft(params.projectId);
    return { status: 200, body: { script }, headers: { "Cache-Control": "no-store" } };
  })
);

projectsRouter.post(
  "/projects/:projectId/fork",
  mutation(async ({ auth }, params) => {
    if (!params.projectId) {
      throw new ApiError("validation_failed", "projectId is required.");
    }
    const { project } = await forkPublicProject({
      workspaceId: auth.workspaceId,
      sourceProjectId: params.projectId,
    });
    return { status: 201, body: { project } };
  })
);

projectsRouter.patch(
  "/projects/:projectId",
  mutation(async ({ auth, body }, params) => {
    if (!params.projectId) {
      throw new ApiError("validation_failed", "projectId is required.");
    }
    const { visibility } = parseSetProjectVisibility(body);
    const project = await setProjectVisibility(
      auth.workspaceId,
      params.projectId,
      visibility,
      { actorId: auth.actor.id }
    );
    return { status: 200, body: { project } };
  })
);

projectsRouter.delete(
  "/projects/:projectId",
  mutation(async ({ auth }, params) => {
    if (!params.projectId) {
      throw new ApiError("validation_failed", "projectId is required.");
    }
    await deleteProject(auth.workspaceId, params.projectId);
    return { status: 200, body: { ok: true } };
  })
);

projectsRouter.delete(
  "/projects/:projectId/admin-delete",
  mutation(async (ctx, params) => {
    if (!params.projectId) {
      throw new ApiError("validation_failed", "projectId is required.");
    }
    await requireProjectAdmin(ctx);
    await deletePublicProjectAsAdmin(params.projectId);
    return { status: 200, body: { ok: true } };
  })
);

// Set the project's poster (the movie-poster thumbnail shown in dashboard
// grids): points the project-scoped 'poster' selection slot at an image asset.
projectsRouter.post(
  "/projects/:projectId/poster",
  mutation(async ({ auth, body }, params) => {
    if (!params.projectId) {
      throw new ApiError("validation_failed", "projectId is required.");
    }
    const assetId = (body as { assetId?: unknown } | null)?.assetId;
    if (typeof assetId !== "string" || assetId.length === 0) {
      throw new ApiError("validation_failed", "assetId is required.");
    }
    const project = await setProjectPoster(auth.workspaceId, params.projectId, assetId);
    return { status: 200, body: { project } };
  })
);

projectsRouter.post(
  "/projects/:projectId/poster/generate",
  mutation(async ({ auth, body }, params) => {
    if (!params.projectId) {
      throw new ApiError("validation_failed", "projectId is required.");
    }
    const record =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    await requireApprovedScriptForProjectMedia(auth.workspaceId, params.projectId);
    const result = await generatePoster(auth, params.projectId, {
      force: record.force === true,
      provider: typeof record.provider === "string" ? record.provider : undefined,
    });
    return { status: result.poster.generated ? 202 : 200, body: result };
  })
);

projectsRouter.get(
  "/projects/:projectId/storyboard",
  route(async ({ auth }, params) => {
    if (!params.projectId) {
      throw new ApiError("validation_failed", "projectId is required.");
    }
    return getStoryboard({ auth, projectId: params.projectId });
  })
);

projectsRouter.get(
  "/projects/:projectId/watch",
  route(async ({ auth }, params) => {
    if (!params.projectId) {
      throw new ApiError("validation_failed", "projectId is required.");
    }
    await recordProjectActivity(auth.workspaceId, params.projectId);
    const media = await getProjectWatchMedia(auth.workspaceId, params.projectId);
    return {
      status: 200,
      body: {
        media,
        fallback: {
          storyboardUrl: `/projects/${encodeURIComponent(params.projectId)}/storyboard`,
        },
      },
    };
  })
);

projectsRouter.put(
  "/projects/:projectId/storyboard",
  mutation(async ({ auth, body }, params) => {
    if (!params.projectId) {
      throw new ApiError("validation_failed", "projectId is required.");
    }
    return putStoryboard({ auth, projectId: params.projectId, body });
  })
);

projectsRouter.post(
  "/projects/:projectId/assets/analyze-batch",
  mutation(async ({ auth, body }, params) => {
    if (!params.projectId) {
      throw new ApiError("validation_failed", "projectId is required.");
    }
    return analyzeAssetBatch({
      auth,
      projectId: params.projectId,
      input: parseAnalyzeBatch(body),
    });
  })
);

projectsRouter.get(
  "/projects/:projectId/assets/analysis-jobs/:jobId",
  route(async ({ auth }, params) => {
    if (!params.projectId) {
      throw new ApiError("validation_failed", "projectId is required.");
    }
    if (!params.jobId) {
      throw new ApiError("validation_failed", "jobId is required.");
    }
    return getAssetAnalysisJob({
      auth,
      projectId: params.projectId,
      jobId: params.jobId,
    });
  })
);
