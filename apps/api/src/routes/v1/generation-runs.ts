import { Router } from "express";
import { mutation, route } from "@/core/adapter";
import { ApiError } from "@/core/errors";
import type { GateableGenerationStageType } from "@popcorn/shared/v1/types";
import {
  getOrchestratorRun,
  listRunGates,
  resolveGate,
  updateOrchestratorRun,
  type OrchestratorRunGate,
} from "@/lib/api/v1/orchestrator-store";
import { getProject } from "@/lib/api/v1/store";
import { resumeOrchestratorRun } from "@/lib/orchestrator/engine";
import {
  approveReviewGate,
  assemblePayload,
  cancelGenerationRun,
  createRunWithSeedStages,
  getGenerationRunStore,
  rejectReviewGate,
  requireRun,
  type CreateGenerationRunBody,
} from "@/lib/v1/generation-runs";
import { resumeGenerationRun } from "@/lib/v1/generation/run-execution";
import { getStore } from "@/lib/v1/store";
import { assembleOrchestratorPayload } from "./orchestrator-run-payload";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function requireParam(params: Record<string, string | undefined>, name: string): string {
  const value = params[name];
  if (!value) {
    throw new ApiError("validation_failed", `${name} is required.`);
  }
  return value;
}

async function requireProjectAccess(workspaceId: string, projectId: string): Promise<void> {
  await getProject(workspaceId, projectId);
}

async function maybeAssembleOrchestratorPayload(runId: string, projectId: string) {
  try {
    const run = await getOrchestratorRun(runId);
    if (run.projectId !== projectId) return null;
    return assembleOrchestratorPayload(run);
  } catch (error) {
    if (error instanceof ApiError && error.code === "not_found") return null;
    throw error;
  }
}

async function requireOrchestratorPayload(runId: string, projectId: string) {
  const payload = await maybeAssembleOrchestratorPayload(runId, projectId);
  if (!payload) {
    throw new ApiError("not_found", `Generation run not found: ${runId}`);
  }
  return payload;
}

async function requireReachedOrchestratorGate(runId: string): Promise<OrchestratorRunGate> {
  const gate = (await listRunGates(runId)).find((candidate) => candidate.status === "reached");
  if (!gate) {
    throw new ApiError("validation_failed", "Run is not awaiting review.");
  }
  return gate;
}

function rejectStageType(body: unknown): GateableGenerationStageType | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const stageType = (body as { stageType?: unknown }).stageType;
  return typeof stageType === "string"
    ? (stageType as GateableGenerationStageType)
    : undefined;
}

export const generationRunsRouter = Router();

generationRunsRouter.get(
  "/projects/:projectId/generation-runs",
  route(async ({ auth }, params) => {
    const projectId = requireParam(params, "projectId");
    await requireProjectAccess(auth.workspaceId, projectId);

    const store = getGenerationRunStore();
    const runs = (await store.listRunsForProject(projectId)).sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1
    );

    return {
      status: 200,
      body: { runs },
      headers: NO_STORE_HEADERS,
    };
  })
);

generationRunsRouter.post(
  "/projects/:projectId/generation-runs",
  mutation(async ({ auth, body }, params) => {
    const projectId = requireParam(params, "projectId");
    await requireProjectAccess(auth.workspaceId, projectId);

    const store = getGenerationRunStore();
    const payload = await createRunWithSeedStages({
      store,
      projectId,
      body: (body ?? {}) as CreateGenerationRunBody,
    });

    return { status: 202, body: payload };
  })
);

generationRunsRouter.get(
  "/projects/:projectId/generation-runs/:runId",
  route(async ({ auth }, params) => {
    const projectId = requireParam(params, "projectId");
    const runId = requireParam(params, "runId");
    await requireProjectAccess(auth.workspaceId, projectId);

    const store = getGenerationRunStore();
    const payload = await assemblePayload(store, runId);
    const verified =
      payload && payload.run.projectId === projectId
        ? requireRun(payload, runId, projectId)
        : await requireOrchestratorPayload(runId, projectId);

    return {
      status: 200,
      body: verified,
      headers: NO_STORE_HEADERS,
    };
  })
);

generationRunsRouter.get(
  "/projects/:projectId/generation-runs/:runId/artifacts/:artifactId",
  route(async ({ auth }, params) => {
    const projectId = requireParam(params, "projectId");
    const runId = requireParam(params, "runId");
    const artifactId = requireParam(params, "artifactId");
    await requireProjectAccess(auth.workspaceId, projectId);

    const runStore = getGenerationRunStore();
    const payload = await assemblePayload(runStore, runId);
    requireRun(payload, runId, projectId);

    const artifact = await runStore.getStageArtifact(artifactId);
    if (!artifact || artifact.runId !== runId) {
      throw new ApiError("not_found", `Generation artifact not found: ${artifactId}`);
    }

    const stage = await runStore.getStage(artifact.stageId);
    let timelineId: string | undefined;
    if (artifact.kind === "timeline" && stage?.jobIds.length) {
      const store = getStore();
      for (const jobId of stage.jobIds) {
        const job = await store.getJob(jobId);
        const result = job?.result as { timelineIds?: unknown } | null;
        const [candidate] = Array.isArray(result?.timelineIds)
          ? result.timelineIds.filter((id): id is string => typeof id === "string")
          : [];
        if (candidate) {
          timelineId = candidate;
          break;
        }
      }
    }

    return {
      status: 200,
      body: {
        artifact,
        ...(timelineId ? { timelineId } : {}),
      },
      headers: NO_STORE_HEADERS,
    };
  })
);

generationRunsRouter.post(
  "/projects/:projectId/generation-runs/:runId/approve",
  mutation(async ({ auth, body }, params) => {
    const projectId = requireParam(params, "projectId");
    const runId = requireParam(params, "runId");
    await requireProjectAccess(auth.workspaceId, projectId);

    const store = getGenerationRunStore();
    const payload = await assemblePayload(store, runId);
    if (!payload || payload.run.projectId !== projectId) {
      const orchestratorPayload = await requireOrchestratorPayload(runId, projectId);
      const gate = orchestratorPayload.run.reviewGate;
      if (!gate) {
        return { status: 200, body: orchestratorPayload };
      }
      const reached = await requireReachedOrchestratorGate(runId);
      await resolveGate(reached.id, "approved");
      const resumed = await resumeOrchestratorRun(runId, { workspaceId: auth.workspaceId });
      return {
        status: 202,
        body: await assembleOrchestratorPayload(resumed),
      };
    }
    const existing = requireRun(payload, runId, projectId);

    const approved = await approveReviewGate(store, runId, body ?? {});
    if (!existing.run.reviewGate) {
      return { status: 200, body: approved };
    }

    await resumeGenerationRun({ runId, projectId, runStore: store });
    const resumed = await assemblePayload(store, runId);
    return { status: 202, body: requireRun(resumed, runId, projectId) };
  })
);

generationRunsRouter.post(
  "/projects/:projectId/generation-runs/:runId/reject",
  mutation(async ({ auth, body }, params) => {
    const projectId = requireParam(params, "projectId");
    const runId = requireParam(params, "runId");
    await requireProjectAccess(auth.workspaceId, projectId);

    const store = getGenerationRunStore();
    const payload = await assemblePayload(store, runId);
    if (!payload || payload.run.projectId !== projectId) {
      const orchestratorPayload = await requireOrchestratorPayload(runId, projectId);
      const gate = orchestratorPayload.run.reviewGate;
      if (!gate) {
        throw new ApiError("validation_failed", "Run is not awaiting review.");
      }
      const requestedStage = rejectStageType(body);
      if (requestedStage !== undefined && requestedStage !== gate.stageType) {
        throw new ApiError("validation_failed", "Reject stageType must match the active review gate.", {
          fields: [{ path: "stageType", message: `Expected ${gate.stageType}.` }],
        });
      }
      const reached = await requireReachedOrchestratorGate(runId);
      await resolveGate(reached.id, "rejected");
      const resumed = await resumeOrchestratorRun(runId, { workspaceId: auth.workspaceId });
      return {
        status: 202,
        body: await assembleOrchestratorPayload(resumed),
      };
    }
    requireRun(payload, runId, projectId);

    await rejectReviewGate(store, runId, body ?? {});

    await resumeGenerationRun({ runId, projectId, runStore: store });
    const resumed = await assemblePayload(store, runId);
    return { status: 202, body: requireRun(resumed, runId, projectId) };
  })
);

generationRunsRouter.post(
  "/projects/:projectId/generation-runs/:runId/cancel",
  mutation(async ({ auth }, params) => {
    const projectId = requireParam(params, "projectId");
    const runId = requireParam(params, "runId");
    await requireProjectAccess(auth.workspaceId, projectId);

    const store = getGenerationRunStore();
    const payload = await assemblePayload(store, runId);
    if (!payload || payload.run.projectId !== projectId) {
      await requireOrchestratorPayload(runId, projectId);
      const canceled = await updateOrchestratorRun(runId, {
        status: "canceled",
        completedAt: new Date().toISOString(),
      });
      return {
        status: 200,
        body: await assembleOrchestratorPayload(canceled),
      };
    }
    requireRun(payload, runId, projectId);

    const canceled = await cancelGenerationRun(store, runId);
    return { status: 200, body: canceled };
  })
);

generationRunsRouter.post(
  "/projects/:projectId/generation-runs/:runId/retry",
  mutation(async ({ auth }, params) => {
    const projectId = requireParam(params, "projectId");
    const runId = requireParam(params, "runId");
    await requireProjectAccess(auth.workspaceId, projectId);

    const store = getGenerationRunStore();
    const payload = await assemblePayload(store, runId);
    requireRun(payload, runId, projectId);

    throw new ApiError(
      "not_implemented",
      "Retry is not supported for generation runs yet.",
      { supported: false, action: "retry" }
    );
  })
);
