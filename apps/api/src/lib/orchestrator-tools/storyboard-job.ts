// Background worker for the async generate_storyboard tool. Generates one sketch
// tile per beat, persists each as an image asset (recording the plan as its
// input), writes the story spine scenes/beats/panels, marks the job terminal,
// and — completion-driven — resumes the parked orchestrator run. Workers run
// inline today (fire-and-forget from the tool's execute), so by the time the run
// resumes the assets are already written.

import { createHash } from "node:crypto";
import { createDurableOrchestratorJobWriter, startDurableJobHeartbeat, type OrchestratorJobWriter } from "@/lib/orchestrator/job-gateway";
import { scheduleOrchestratorResume } from "@/lib/orchestrator/schedule-resume";
import type { AuthContext } from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import {
  addStoryboardTiles,
  getAsset,
  getProjectCurrentStoryboardId,
  getProjectStoryboardById,
  uploadStoryboardTileObjects,
} from "@/lib/api/v1/store";
import {
  buildStoryboardForPlan,
  commitClaimedStoryboardBundle,
  markStoryboardHandoffReady,
  publishStoryboard,
} from "@/lib/api/v1/storyboards";
import { generateStoryboardTilesForPlan } from "@/lib/v1/generation/storyboard";
import type { ShotPlan } from "@popcorn/shared/types";
import {
  persistedBeatIdSetIssues,
  plannedBeatIds,
  preservedStoryboardTiles,
  storyboardHandoffIssues,
  storyboardTileByPlanBeat,
} from "./storyboard-keyframe-handoff";
import { shotPlanForTargetBeats } from "./visual-targeting";

export interface StoryboardJobDeps {
  generateStoryboardTilesForPlan: typeof generateStoryboardTilesForPlan;
  addStoryboardTiles: typeof addStoryboardTiles;
  uploadStoryboardTileObjects: typeof uploadStoryboardTileObjects;
  buildStoryboardForPlan: typeof buildStoryboardForPlan;
  commitClaimedStoryboardBundle: typeof commitClaimedStoryboardBundle;
  getProjectStoryboardById: typeof getProjectStoryboardById;
  getProjectCurrentStoryboardId: typeof getProjectCurrentStoryboardId;
  getAsset: typeof getAsset;
  markStoryboardHandoffReady: typeof markStoryboardHandoffReady;
  publishStoryboard: typeof publishStoryboard;
  jobs?: Pick<OrchestratorJobWriter, "setStep" | "succeed" | "fail"> & Partial<Pick<OrchestratorJobWriter, "reportProgress">>;
  enqueueOrchestratorDispatch?: (runId: string, workspaceId: string) => Promise<unknown>;
}

const defaultDeps: StoryboardJobDeps = {
  generateStoryboardTilesForPlan,
  addStoryboardTiles,
  uploadStoryboardTileObjects,
  buildStoryboardForPlan,
  commitClaimedStoryboardBundle,
  getProjectStoryboardById,
  getProjectCurrentStoryboardId,
  getAsset,
  markStoryboardHandoffReady,
  publishStoryboard,
};

function localAuth(workspaceId: string): AuthContext {
  return {
    mode: "local",
    actor: { id: "orchestrator", type: "local" },
    workspaceId,
    isLocal: true,
  };
}

async function resume(
  deps: StoryboardJobDeps,
  runId: string,
  workspaceId: string
): Promise<void> {
  await scheduleOrchestratorResume({ runId, workspaceId, enqueue: deps.enqueueOrchestratorDispatch });
}

function isStaleStoryboardClaim(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.code === "database_error" &&
    typeof error.details?.dbMessage === "string" &&
    error.details.dbMessage.includes("stale_session_claim")
  );
}

export interface StoryboardJobInput {
  jobId: string;
  workspaceId: string;
  projectId: string;
  orchestratorRunId?: string;
  sessionClaimGeneration?: number;
  plan: ShotPlan;
  planAssetId: string;
  planContentHash: string;
  expectedPlanSelectionSeq?: number;
  expectedCurrentStoryboardId?: string | null;
  targetBeatIds?: string[];
  baselineStoryboardId?: string;
  createdByActionId?: string;
}

function deterministicUuid(jobId: string, label: string): string {
  const bytes = createHash("sha256").update(`${jobId}:${label}`).digest().subarray(0, 16);
  // RFC 9562 UUIDv8: deterministic application-defined payload.
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function bundleIdsForPlan(jobId: string, plan: ShotPlan) {
  return {
    storyboardId: deterministicUuid(jobId, "storyboard"),
    actId: deterministicUuid(jobId, "act"),
    scenes: plan.scenes.map((scene, sceneIndex) => ({
      sceneId: deterministicUuid(jobId, `scene:${sceneIndex}`),
      beats: scene.beats.map((_beat, beatIndex) => ({
        beatId: deterministicUuid(jobId, `beat:${sceneIndex}:${beatIndex}`),
        panelId: deterministicUuid(jobId, `panel:${sceneIndex}:${beatIndex}`),
      })),
    })),
  };
}

async function completeExistingClaimedBundle(input: {
  jobInput: StoryboardJobInput;
  deps: StoryboardJobDeps;
  jobs: Pick<OrchestratorJobWriter, "succeed">;
  storyboardId: string;
}): Promise<boolean> {
  const existing = await input.deps.getProjectStoryboardById(
    input.jobInput.workspaceId,
    input.jobInput.projectId,
    input.storyboardId
  );
  if (!existing) return false;

  const handoffIssues = await storyboardHandoffIssues({
    plan: input.jobInput.plan,
    planAssetId: input.jobInput.planAssetId,
    storyboard: existing,
    loadAsset: (assetId) =>
      input.deps.getAsset(
        input.jobInput.workspaceId,
        input.jobInput.projectId,
        assetId
      ),
  });
  const expectedAssetBeatIds = plannedBeatIds(
    shotPlanForTargetBeats(input.jobInput.plan, input.jobInput.targetBeatIds)
  );
  const existingTiles = storyboardTileByPlanBeat(input.jobInput.plan, existing);
  const assetIds = expectedAssetBeatIds.flatMap((beatId) => {
    const assetId = existingTiles.get(beatId);
    return assetId ? [assetId] : [];
  });
  if (
    handoffIssues.length > 0 ||
    assetIds.length !== expectedAssetBeatIds.length
  ) {
    throw new Error(
      `Existing claimed storyboard is not a complete replay (${handoffIssues
        .map((issue) => issue.code)
        .join(", ") || "missing generated asset"}).`
    );
  }
  await input.jobs.succeed(input.jobInput.jobId, {
    assetIds,
    storyboardId: existing.id,
  });
  return true;
}

/**
 * Stale-running recovery probe. It never invokes a provider: it only
 * reconciles the job if this job's deterministic storyboard bundle is already
 * complete and visible.
 */
export async function reconcileCommittedStoryboardJob(
  input: StoryboardJobInput,
  deps: Partial<StoryboardJobDeps> = {}
): Promise<boolean> {
  const d = { ...defaultDeps, ...deps };
  const jobs =
    d.jobs ??
    createDurableOrchestratorJobWriter(input.workspaceId, input.projectId);
  const ids = bundleIdsForPlan(input.jobId, input.plan);
  return completeExistingClaimedBundle({
    jobInput: input,
    deps: d,
    jobs,
    storyboardId: ids.storyboardId,
  });
}

export async function runStoryboardJob(
  input: StoryboardJobInput,
  deps: Partial<StoryboardJobDeps> = {}
): Promise<void> {
  const d = { ...defaultDeps, ...deps };
  const jobs = d.jobs ?? createDurableOrchestratorJobWriter(input.workspaceId, input.projectId);
  const stopHeartbeat = startDurableJobHeartbeat(jobs, input.jobId);
  const ids = bundleIdsForPlan(input.jobId, input.plan);
  try {
    await jobs.setStep(input.jobId, "generating_assets");
    const claimed = input.sessionClaimGeneration !== undefined;
    if (
      claimed &&
      (!input.orchestratorRunId ||
        !input.createdByActionId ||
        input.expectedPlanSelectionSeq === undefined ||
        input.expectedCurrentStoryboardId === undefined)
    ) {
      throw new Error(
        "Claimed storyboard work requires exact run, action, plan-selection, and pointer fences."
      );
    }
    const generationPlan = shotPlanForTargetBeats(input.plan, input.targetBeatIds);
    const expectedGeneratedBeatIds = plannedBeatIds(generationPlan);
    if (expectedGeneratedBeatIds.length === 0) {
      throw new Error("Storyboard generation has no targeted plan beats.");
    }
    if (
      claimed &&
      await completeExistingClaimedBundle({
        jobInput: input,
        deps: d,
        jobs,
        storyboardId: ids.storyboardId,
      })
    ) {
      return;
    }
    const fullBeatIds = plannedBeatIds(input.plan);
    const isPartial = expectedGeneratedBeatIds.length !== fullBeatIds.length;
    const baseline = input.baselineStoryboardId
      ? await d.getProjectStoryboardById(
          input.workspaceId,
          input.projectId,
          input.baselineStoryboardId
        )
      : null;
    if (isPartial && !baseline) {
      throw new Error(
        "Scoped storyboard generation requires a complete compatible preservation baseline."
      );
    }
    const preservation = baseline
      ? await preservedStoryboardTiles({
          plan: input.plan,
          planAssetId: input.planAssetId,
          planContentHash: input.planContentHash,
          storyboard: baseline,
          targetBeatIds: expectedGeneratedBeatIds,
          loadAsset: (assetId) =>
            d.getAsset(input.workspaceId, input.projectId, assetId),
        })
      : [];
    const newAssetIds = expectedGeneratedBeatIds.map((beatId) =>
      deterministicUuid(input.jobId, `asset:${beatId}`)
    );

    const tiles = await d.generateStoryboardTilesForPlan({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      plan: generationPlan,
    });

    if (claimed) {
      const currentPointer = await d.getProjectCurrentStoryboardId(
        input.workspaceId,
        input.projectId
      );
      if (currentPointer !== input.expectedCurrentStoryboardId) {
        throw new Error("The current storyboard changed before tile persistence.");
      }
      const uploaded = await d.uploadStoryboardTileObjects({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        tiles,
        assetIds: newAssetIds,
      });
      const uploadedIssues = persistedBeatIdSetIssues(
        generationPlan,
        uploaded.map((tile) => tile.beatId)
      );
      if (uploadedIssues.length > 0) {
        throw new Error(
          `Storyboard tile upload did not cover the scoped plan (${uploadedIssues
            .map((issue) => issue.code)
            .join(", ")}).`
        );
      }
      const tileAssetByBeatId = new Map(
        preservation.map((tile) => [tile.planBeatId, tile.assetId])
      );
      for (const tile of uploaded) tileAssetByBeatId.set(tile.beatId, tile.assetId);
      const commitInput = {
        auth: localAuth(input.workspaceId),
        projectId: input.projectId,
        jobId: input.jobId,
        actionId: input.createdByActionId!,
        orchestratorRunId: input.orchestratorRunId!,
        sessionClaimGeneration: input.sessionClaimGeneration!,
        planAssetId: input.planAssetId,
        planContentHash: input.planContentHash,
        expectedPlanSelectionSeq: input.expectedPlanSelectionSeq!,
        expectedCurrentStoryboardId: input.expectedCurrentStoryboardId!,
        baselineStoryboardId: input.baselineStoryboardId ?? null,
        preservation,
        plan: input.plan,
        uploadedTiles: uploaded,
        tileAssetByBeatId,
        ids,
      };
      let committed: Awaited<
        ReturnType<StoryboardJobDeps["commitClaimedStoryboardBundle"]>
      >;
      try {
        committed = await d.commitClaimedStoryboardBundle(commitInput);
      } catch {
        // A response can be lost after PostgreSQL commits. The bundle ids and
        // payload are job-deterministic, so one exact retry is a safe replay.
        committed = await d.commitClaimedStoryboardBundle(commitInput);
      }
      const storyboard = await d.getProjectStoryboardById(
        input.workspaceId,
        input.projectId,
        committed.storyboardId
      );
      if (!storyboard) throw new Error("Claimed storyboard commit could not be reloaded.");
      const handoffIssues = await storyboardHandoffIssues({
        plan: input.plan,
        planAssetId: input.planAssetId,
        storyboard,
        loadAsset: (assetId) =>
          d.getAsset(input.workspaceId, input.projectId, assetId),
      });
      if (handoffIssues.length > 0) {
        throw new Error(
          `Claimed storyboard is not ready for keyframes (${handoffIssues
            .map((issue) => issue.code)
            .join(", ")}).`
        );
      }
      await jobs.succeed(input.jobId, {
        assetIds: committed.assetIds,
        storyboardId: committed.storyboardId,
      });
      return;
    }

    const persisted = await d.addStoryboardTiles({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      planAssetId: input.planAssetId,
      planContentHash: input.planContentHash,
      tiles,
      ...(input.createdByActionId ? { createdByActionId: input.createdByActionId } : {}),
    });

    const expectedBeatIds = plannedBeatIds(generationPlan);
    const persistedIssues = persistedBeatIdSetIssues(
      generationPlan,
      persisted.map((tile) => tile.beatId)
    );
    if (expectedBeatIds.length === 0 || persistedIssues.length > 0) {
      throw new Error(
        `Storyboard tile persistence did not cover the shot plan (${persistedIssues
          .map((issue) => issue.code)
          .join(", ") || "no planned beats"}).`
      );
    }

    const tileAssetByBeatId = new Map(persisted.map((tile) => [tile.beatId, tile.assetId]));
    const { storyboardId, panelCount } = await d.buildStoryboardForPlan({
      auth: localAuth(input.workspaceId),
      projectId: input.projectId,
      planAssetId: input.planAssetId,
      plan: generationPlan,
      tileAssetByBeatId,
    });
    if (panelCount !== expectedBeatIds.length) {
      throw new Error(
        `Storyboard built ${panelCount} selected panels for ${expectedBeatIds.length} planned beats.`
      );
    }

    const storyboard = await d.getProjectStoryboardById(
      input.workspaceId,
      input.projectId,
      storyboardId
    );
    if (!storyboard) {
      throw new Error("Storyboard could not be reloaded after persistence.");
    }
    const handoffIssues = await storyboardHandoffIssues({
      plan: input.plan,
      planAssetId: input.planAssetId,
      storyboard,
      loadAsset: (assetId) => d.getAsset(input.workspaceId, input.projectId, assetId),
    });
    if (handoffIssues.length > 0) {
      throw new Error(
        `Storyboard is not ready for keyframes (${handoffIssues
          .map((issue) => issue.code)
          .join(", ")}).`
      );
    }

    const publication = {
      auth: localAuth(input.workspaceId),
      projectId: input.projectId,
      storyboardId,
    };
    await d.markStoryboardHandoffReady(publication);
    await d.publishStoryboard(publication);

    await jobs.succeed(input.jobId, {
      assetIds: persisted.map((tile) => tile.assetId),
      storyboardId,
    });
  } catch (err) {
    // The database already rejected every visible write. Its terminal job
    // trigger will also reject an ex-owner's fail/succeed transition, so leave
    // cleanup to the current owner/cancellation path instead of surfacing an
    // unhandled second stale-claim error.
    if (isStaleStoryboardClaim(err)) return;
    if (input.sessionClaimGeneration !== undefined) {
      try {
        if (
          await completeExistingClaimedBundle({
            jobInput: input,
            deps: d,
            jobs,
            storyboardId: ids.storyboardId,
          })
        ) {
          return;
        }
      } catch {
        // Preserve the original commit/provider error when recovery itself
        // cannot prove that a complete deterministic bundle is visible.
      }
    }
    await jobs.fail(input.jobId, {
      code: "job_failed",
      message: err instanceof Error ? err.message : String(err),
      requestId: "",
    });
  } finally {
    stopHeartbeat();
    // Completion-driven resume; best-effort so a synthetic/absent run (e.g. the
    // test harness, which uses an in-memory run id) can't crash the worker.
    if (input.orchestratorRunId) {
      try {
        await resume(d, input.orchestratorRunId, input.workspaceId);
      } catch {
        // ignore — a sweeper reclaims any run left parked.
      }
    }
  }
}
