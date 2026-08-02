import { Router } from "express";
import { mutation, route } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import type { HandlerCtx } from "@/lib/api/v1/handler";
import { agentApiStore } from "@/lib/agent-api/jobs";
import {
  createBeat,
  createPanel,
  createScene,
  createStoryboard,
  deleteBeat,
  deletePanel,
  deleteScene,
  deleteStoryboard,
  getStoryboard,
  listBeats,
  listPanels,
  listScenes,
  listStoryboards,
  parseBeatInput,
  parsePanelInput,
  parseSceneInput,
  parseStoryboardInput,
  searchStoryboardChunks,
  updateBeat,
  updatePanel,
  updateScene,
  updateStoryboard,
} from "@/lib/api/v1/storyboards";
import { generateSceneWireframe } from "@/lib/api/v1/scene-wireframe";
import { regenerateStoryBlueprint } from "@/lib/api/v1/blueprint-regenerate";
import { generateActMockup, listActs } from "@/lib/api/v1/storyboard-acts";
import { parsePagination } from "@/lib/api/v1/schemas";
import {
  getActiveProjectPlan,
  getProject,
} from "@/lib/api/v1/store";
import { runStoryboardJob } from "@/lib/orchestrator-tools/storyboard-job";

export const storyboardsRouter = Router();

function requiredParam(
  params: Record<string, string | undefined>,
  name: string
): string {
  const value = params[name];
  if (!value) {
    throw new ApiError("validation_failed", `${name} is required.`);
  }
  return value;
}

function scopedIdempotencyKey(
  req: { header(name: string): string | null },
  projectId: string
): string | null {
  const key = req.header("Idempotency-Key");
  return key ? `${projectId}:${key}` : null;
}

interface GenerateStoryboardPanelsDeps {
  getProject: typeof getProject;
  getActiveProjectPlan: typeof getActiveProjectPlan;
  createOrGetJob: typeof agentApiStore.createOrGetJob;
  runStoryboardJob: typeof runStoryboardJob;
}

export async function generateStoryboardPanelsRoute(
  ctx: Pick<HandlerCtx, "auth" | "req">,
  params: Record<string, string | undefined>,
  deps: Partial<GenerateStoryboardPanelsDeps> = {}
) {
  const resolved: GenerateStoryboardPanelsDeps = {
    getProject,
    getActiveProjectPlan,
    createOrGetJob: agentApiStore.createOrGetJob,
    runStoryboardJob,
    ...deps,
  };
  const projectId = requiredParam(params, "projectId");
  await resolved.getProject(ctx.auth.workspaceId, projectId);

  const activePlan = await resolved.getActiveProjectPlan(projectId);
  if (!activePlan) {
    throw new ApiError(
      "plan_missing",
      "A shot plan is required before generating storyboard panels."
    );
  }

  const { job, created } = await resolved.createOrGetJob({
    type: "asset_generation",
    projectId,
    idempotencyKey: scopedIdempotencyKey(ctx.req, projectId),
  });

  if (created) {
    void resolved.runStoryboardJob({
      jobId: job.id,
      workspaceId: ctx.auth.workspaceId,
      projectId,
      plan: activePlan.plan,
      planAssetId: activePlan.assetId,
      planContentHash: activePlan.contentHash,
    });
  }

  return { status: created ? 202 : 200, body: { job } };
}

storyboardsRouter.get(
  "/projects/:projectId/storyboards",
  route(async ({ auth }, params) => {
    const storyboards = await listStoryboards({
      auth,
      projectId: requiredParam(params, "projectId"),
    });
    return { status: 200, body: { storyboards } };
  })
);

storyboardsRouter.post(
  "/projects/:projectId/storyboards",
  mutation(async ({ auth, body }, params) => {
    const storyboard = await createStoryboard({
      auth,
      projectId: requiredParam(params, "projectId"),
      data: parseStoryboardInput(body),
    });
    return { status: 201, body: { storyboard } };
  })
);

storyboardsRouter.post(
  "/projects/:projectId/storyboards/generate",
  route((ctx, params) => generateStoryboardPanelsRoute(ctx, params))
);

// Latest storyboard generation job for the project (or null). The job id only
// lives in transient client state, so this lets the dashboard resume polling
// and keep its loading indicator after a page reload mid-generation.
storyboardsRouter.get(
  "/projects/:projectId/storyboards/generate",
  route(async ({ auth }, params) => {
    const projectId = requiredParam(params, "projectId");
    await getProject(auth.workspaceId, projectId);

    const job = await agentApiStore.findLatestJobForProject({
      type: "asset_generation",
      projectId,
    });

    return { status: 200, body: { job: job ?? null } };
  })
);

storyboardsRouter.get(
  "/projects/:projectId/storyboards/generate/:jobId",
  route(async ({ auth }, params) => {
    const projectId = requiredParam(params, "projectId");
    const jobId = requiredParam(params, "jobId");
    await getProject(auth.workspaceId, projectId);

    const job = await agentApiStore.getJob(jobId);
    if (!job || job.type !== "asset_generation" || job.projectId !== projectId) {
      throw new ApiError("not_found", "Storyboard generation job not found.", {
        jobId,
      });
    }

    return { status: 200, body: { job } };
  })
);

storyboardsRouter.get(
  "/projects/:projectId/storyboards/search",
  route(async ({ auth, req }, params) => {
    const q = req.searchParams.get("q") ?? "";
    if (!q.trim()) {
      throw new ApiError("validation_failed", "q is required.", {
        fields: [{ path: "q", message: "Search query is required." }],
      });
    }
    const { limit } = parsePagination(req.searchParams);
    const chunks = await searchStoryboardChunks({
      auth,
      projectId: requiredParam(params, "projectId"),
      query: q,
      storyboardId: req.searchParams.get("storyboardId"),
      limit,
    });
    return { status: 200, body: { chunks } };
  })
);

storyboardsRouter.get(
  "/projects/:projectId/storyboards/:storyboardId",
  route(async ({ auth }, params) => {
    const storyboard = await getStoryboard({
      auth,
      projectId: requiredParam(params, "projectId"),
      storyboardId: requiredParam(params, "storyboardId"),
    });
    return { status: 200, body: { storyboard } };
  })
);

storyboardsRouter.put(
  "/projects/:projectId/storyboards/:storyboardId",
  mutation(async ({ auth, body }, params) => {
    const storyboard = await updateStoryboard({
      auth,
      projectId: requiredParam(params, "projectId"),
      storyboardId: requiredParam(params, "storyboardId"),
      data: parseStoryboardInput(body),
    });
    return { status: 200, body: { storyboard } };
  })
);

storyboardsRouter.delete(
  "/projects/:projectId/storyboards/:storyboardId",
  mutation(async ({ auth }, params) => {
    await deleteStoryboard({
      auth,
      projectId: requiredParam(params, "projectId"),
      storyboardId: requiredParam(params, "storyboardId"),
    });
    return { status: 200, body: { ok: true } };
  })
);

// Regenerate the story blueprint behind this storyboard: derive a fresh
// blueprint from the active brief (optionally steered by `feedback`) as a NEW
// versioned storyboard that becomes the project's current one. Downstream
// scenes/beats/panels of the old storyboard are untouched — nothing cascades.
storyboardsRouter.post(
  "/projects/:projectId/storyboards/:storyboardId/regenerate",
  mutation(async ({ auth, body }, params) => {
    const feedback =
      body && typeof body === "object" && !Array.isArray(body) &&
      typeof (body as { feedback?: unknown }).feedback === "string"
        ? ((body as { feedback: string }).feedback)
        : undefined;
    const result = await regenerateStoryBlueprint({
      auth,
      projectId: requiredParam(params, "projectId"),
      storyboardId: requiredParam(params, "storyboardId"),
      feedback,
    });
    const storyboard = await getStoryboard({
      auth,
      projectId: requiredParam(params, "projectId"),
      storyboardId: result.storyboardId,
    });
    return {
      status: 201,
      body: {
        storyboard,
        assetId: result.assetId,
        supersededStoryboardId: result.supersededStoryboardId,
      },
    };
  })
);

storyboardsRouter.get(
  "/projects/:projectId/storyboards/:storyboardId/acts",
  route(async ({ auth }, params) => {
    const acts = await listActs({
      auth,
      projectId: requiredParam(params, "projectId"),
      storyboardId: requiredParam(params, "storyboardId"),
    });
    return { status: 200, body: { acts } };
  })
);

// Generate (or regenerate) an act's disposable CARTOON mockup — the act-level
// review tile — and point mockup_asset_id at it.
storyboardsRouter.post(
  "/projects/:projectId/storyboards/:storyboardId/acts/:actId/mockup",
  mutation(async ({ auth, body }, params) => {
    const prompt =
      body && typeof body === "object" && !Array.isArray(body) &&
      typeof (body as { prompt?: unknown }).prompt === "string"
        ? ((body as { prompt: string }).prompt)
        : undefined;
    const result = await generateActMockup({
      auth,
      projectId: requiredParam(params, "projectId"),
      storyboardId: requiredParam(params, "storyboardId"),
      actId: requiredParam(params, "actId"),
      prompt,
    });
    return { status: 201, body: result };
  })
);

storyboardsRouter.get(
  "/projects/:projectId/storyboards/:storyboardId/scenes",
  route(async ({ auth }, params) => {
    const scenes = await listScenes({
      auth,
      projectId: requiredParam(params, "projectId"),
      storyboardId: requiredParam(params, "storyboardId"),
    });
    return { status: 200, body: { scenes } };
  })
);

storyboardsRouter.post(
  "/projects/:projectId/storyboards/:storyboardId/scenes",
  mutation(async ({ auth, body }, params) => {
    const scene = await createScene({
      auth,
      projectId: requiredParam(params, "projectId"),
      storyboardId: requiredParam(params, "storyboardId"),
      data: parseSceneInput(body),
    });
    return { status: 201, body: { scene } };
  })
);

storyboardsRouter.put(
  "/projects/:projectId/storyboards/:storyboardId/scenes/:sceneId",
  mutation(async ({ auth, body }, params) => {
    const scene = await updateScene({
      auth,
      projectId: requiredParam(params, "projectId"),
      storyboardId: requiredParam(params, "storyboardId"),
      sceneId: requiredParam(params, "sceneId"),
      data: parseSceneInput(body),
    });
    return { status: 200, body: { scene } };
  })
);

storyboardsRouter.delete(
  "/projects/:projectId/storyboards/:storyboardId/scenes/:sceneId",
  mutation(async ({ auth }, params) => {
    await deleteScene({
      auth,
      projectId: requiredParam(params, "projectId"),
      storyboardId: requiredParam(params, "storyboardId"),
      sceneId: requiredParam(params, "sceneId"),
    });
    return { status: 200, body: { ok: true } };
  })
);

storyboardsRouter.get(
  "/projects/:projectId/storyboards/:storyboardId/scenes/:sceneId/beats",
  route(async ({ auth }, params) => {
    const beats = await listBeats({
      auth,
      projectId: requiredParam(params, "projectId"),
      storyboardId: requiredParam(params, "storyboardId"),
      sceneId: requiredParam(params, "sceneId"),
    });
    return { status: 200, body: { beats } };
  })
);

storyboardsRouter.post(
  "/projects/:projectId/storyboards/:storyboardId/scenes/:sceneId/beats",
  mutation(async ({ auth, body }, params) => {
    const beat = await createBeat({
      auth,
      projectId: requiredParam(params, "projectId"),
      storyboardId: requiredParam(params, "storyboardId"),
      sceneId: requiredParam(params, "sceneId"),
      data: parseBeatInput(body),
    });
    return { status: 201, body: { beat } };
  })
);

storyboardsRouter.put(
  "/projects/:projectId/storyboards/:storyboardId/scenes/:sceneId/beats/:beatId",
  mutation(async ({ auth, body }, params) => {
    const beat = await updateBeat({
      auth,
      projectId: requiredParam(params, "projectId"),
      storyboardId: requiredParam(params, "storyboardId"),
      sceneId: requiredParam(params, "sceneId"),
      beatId: requiredParam(params, "beatId"),
      data: parseBeatInput(body),
    });
    return { status: 200, body: { beat } };
  })
);

storyboardsRouter.delete(
  "/projects/:projectId/storyboards/:storyboardId/scenes/:sceneId/beats/:beatId",
  mutation(async ({ auth }, params) => {
    await deleteBeat({
      auth,
      projectId: requiredParam(params, "projectId"),
      storyboardId: requiredParam(params, "storyboardId"),
      sceneId: requiredParam(params, "sceneId"),
      beatId: requiredParam(params, "beatId"),
    });
    return { status: 200, body: { ok: true } };
  })
);

storyboardsRouter.get(
  "/projects/:projectId/storyboards/:storyboardId/scenes/:sceneId/beats/:beatId/panels",
  route(async ({ auth }, params) => {
    const panels = await listPanels({
      auth,
      projectId: requiredParam(params, "projectId"),
      storyboardId: requiredParam(params, "storyboardId"),
      sceneId: requiredParam(params, "sceneId"),
      beatId: requiredParam(params, "beatId"),
    });
    return { status: 200, body: { panels } };
  })
);

storyboardsRouter.post(
  "/projects/:projectId/storyboards/:storyboardId/scenes/:sceneId/beats/:beatId/panels",
  mutation(async ({ auth, body }, params) => {
    const panel = await createPanel({
      auth,
      projectId: requiredParam(params, "projectId"),
      storyboardId: requiredParam(params, "storyboardId"),
      sceneId: requiredParam(params, "sceneId"),
      beatId: requiredParam(params, "beatId"),
      data: parsePanelInput(body),
    });
    return { status: 201, body: { panel } };
  })
);

storyboardsRouter.put(
  "/projects/:projectId/storyboards/:storyboardId/scenes/:sceneId/beats/:beatId/panels/:panelId",
  mutation(async ({ auth, body }, params) => {
    const panel = await updatePanel({
      auth,
      projectId: requiredParam(params, "projectId"),
      storyboardId: requiredParam(params, "storyboardId"),
      sceneId: requiredParam(params, "sceneId"),
      beatId: requiredParam(params, "beatId"),
      panelId: requiredParam(params, "panelId"),
      data: parsePanelInput(body),
    });
    return { status: 200, body: { panel } };
  })
);

storyboardsRouter.delete(
  "/projects/:projectId/storyboards/:storyboardId/scenes/:sceneId/beats/:beatId/panels/:panelId",
  mutation(async ({ auth }, params) => {
    await deletePanel({
      auth,
      projectId: requiredParam(params, "projectId"),
      storyboardId: requiredParam(params, "storyboardId"),
      sceneId: requiredParam(params, "sceneId"),
      beatId: requiredParam(params, "beatId"),
      panelId: requiredParam(params, "panelId"),
    });
    return { status: 200, body: { ok: true } };
  })
);

// Generate (or regenerate) a scene's disposable CARTOON wireframe — the
// high-level review panel — and point scene_asset_id at it.
storyboardsRouter.post(
  "/projects/:projectId/storyboards/:storyboardId/scenes/:sceneId/wireframe",
  mutation(async ({ auth, body }, params) => {
    const prompt =
      body && typeof body === "object" && !Array.isArray(body) &&
      typeof (body as { prompt?: unknown }).prompt === "string"
        ? ((body as { prompt: string }).prompt)
        : undefined;
    const result = await generateSceneWireframe({
      auth,
      projectId: requiredParam(params, "projectId"),
      storyboardId: requiredParam(params, "storyboardId"),
      sceneId: requiredParam(params, "sceneId"),
      prompt,
    });
    return { status: 201, body: result };
  })
);
