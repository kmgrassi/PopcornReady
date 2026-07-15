import { scheduleOrchestratorResume } from "@/lib/orchestrator/schedule-resume";
import {
  createDurableOrchestratorJobWriter,
  startDurableJobHeartbeat,
  type OrchestratorJobWriter,
} from "@/lib/orchestrator/job-gateway";
import { createLogger, type Logger } from "@/lib/v1/logger";
import { redactError } from "@/lib/v1/redact";
import type { AuthContext } from "@/lib/api/v1/auth";
import { createGeneratedAsset as realCreateGeneratedAsset } from "@/lib/api/v1/generated-assets";
import { generateCharacterAnchor as realGenerateCharacterAnchor } from "@/lib/api/v1/character-anchors";
import {
  selectGeneratedAnchorAsset as realSelectGeneratedAnchorAsset,
  type VisualAnchorPlan,
  type VisualAnchorPlanItem,
} from "@/lib/api/v1/store";
import type { GraphAssetInput } from "@/lib/api/v1/asset-graph";

type AnchorImageProvider = "openai" | "gemini" | "mock";

export interface GenerateAnchorJobDeps {
  generateCharacterAnchor: typeof realGenerateCharacterAnchor;
  createGeneratedAsset: typeof realCreateGeneratedAsset;
  selectGeneratedAnchorAsset: typeof realSelectGeneratedAnchorAsset;
  jobs?: Pick<OrchestratorJobWriter, "setStep" | "succeed" | "fail"> &
    Partial<Pick<OrchestratorJobWriter, "reportProgress">>;
  logger: Logger;
  enqueueOrchestratorDispatch?: (runId: string, workspaceId: string) => Promise<unknown>;
}

const defaultDeps: GenerateAnchorJobDeps = {
  generateCharacterAnchor: realGenerateCharacterAnchor,
  createGeneratedAsset: realCreateGeneratedAsset,
  selectGeneratedAnchorAsset: realSelectGeneratedAnchorAsset,
  logger: createLogger(),
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
  deps: GenerateAnchorJobDeps,
  runId: string,
  workspaceId: string
): Promise<void> {
  await scheduleOrchestratorResume({ runId, workspaceId, enqueue: deps.enqueueOrchestratorDispatch });
}

function mentionsMinor(anchor: VisualAnchorPlanItem): boolean {
  return /\b(baby|boy|child|girl|kid|minor|teen|toddler|youth)\b/i.test(
    `${anchor.label} ${anchor.description}`
  );
}

function providerForAnchor(
  anchor: VisualAnchorPlanItem,
  requestedProvider?: AnchorImageProvider
): AnchorImageProvider | undefined {
  if (mentionsMinor(anchor)) return "gemini";
  return requestedProvider;
}

function promptForAnchor(anchor: VisualAnchorPlanItem): string {
  if (anchor.kind === "character") {
    return [
      `Create a reusable character reference image for ${anchor.label}.`,
      anchor.description,
      "Full-face, consistent identity, wardrobe, and proportions; neutral pose; production-ready reference.",
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (anchor.kind === "location") {
    return [
      `Create a reusable scene/location reference image for ${anchor.label}.`,
      anchor.description,
      "No text overlays; establish lighting, palette, geography, and reusable visual continuity.",
    ]
      .filter(Boolean)
      .join(" ");
  }
  return [
    `Create a reusable visual style reference image for ${anchor.label}.`,
    anchor.description,
    "No text overlays; emphasize palette, lens, texture, lighting, and art direction.",
  ]
    .filter(Boolean)
    .join(" ");
}

function assetIdsFromResult(result: Awaited<ReturnType<typeof realCreateGeneratedAsset>>): string[] {
  const job = result.body.job as { result?: { assetIds?: unknown } } | undefined;
  const ids = job?.result?.assetIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

async function generateAnchorAsset(input: {
  deps: GenerateAnchorJobDeps;
  auth: AuthContext;
  projectId: string;
  anchor: VisualAnchorPlanItem;
  role: "character_anchor" | "scene_anchor";
  provider?: AnchorImageProvider;
  graphInputs: GraphAssetInput[];
  orchestratorRunId?: string;
}): Promise<string[]> {
  const prompt = promptForAnchor(input.anchor);
  if (input.anchor.kind === "character") {
    const result = await input.deps.generateCharacterAnchor({
      auth: input.auth,
      projectId: input.projectId,
      characterId: input.anchor.id,
      body: {
        autocreate: true,
        name: input.anchor.label,
        // The plan item's id (e.g. "character_homeowner") becomes the asset's
        // stable, agent-referenceable slug.
        slug: input.anchor.id,
        description: input.anchor.description,
        prompt,
        ...(input.provider ? { provider: input.provider } : {}),
        assetRole: input.role,
        graphInputs: input.graphInputs,
        ...(input.orchestratorRunId ? { runId: input.orchestratorRunId } : {}),
      },
    });
    return assetIdsFromResult(result);
  }

  const result = await input.deps.createGeneratedAsset({
    auth: input.auth,
    projectId: input.projectId,
    body: {
      kind: "image",
      prompt,
      name: input.anchor.label,
      // The plan item's id (e.g. "location_driveway") becomes the asset slug.
      slug: input.anchor.id,
      description: input.anchor.description,
      ...(input.provider ? { provider: input.provider } : {}),
      assetRole: input.role,
      graphInputs: input.graphInputs,
      ...(input.orchestratorRunId ? { runId: input.orchestratorRunId } : {}),
    },
  });
  return assetIdsFromResult(result);
}

export interface GenerateAnchorJobInput {
  jobId: string;
  workspaceId: string;
  projectId: string;
  orchestratorRunId?: string;
  visualAnchorPlan: VisualAnchorPlan;
  visualAnchorPlanAssetId: string;
  visualAnchorPlanContentHash: string;
  provider?: AnchorImageProvider;
}

export async function runGenerateAnchorJob(
  input: GenerateAnchorJobInput,
  deps: Partial<GenerateAnchorJobDeps> = {}
): Promise<void> {
  const d = { ...defaultDeps, ...deps };
  const jobs = d.jobs ?? createDurableOrchestratorJobWriter(input.workspaceId, input.projectId);
  const stopHeartbeat = startDurableJobHeartbeat(jobs, input.jobId);
  const logger = d.logger.child({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    runId: input.orchestratorRunId,
    jobId: input.jobId,
    jobType: "asset_generation",
  });
  const startedAt = Date.now();
  try {
    const totalItems = input.visualAnchorPlan.anchors.length;
    await jobs.setStep(input.jobId, "generating_assets", {
      completedItems: 0,
      totalItems,
      percent: totalItems === 0 ? 100 : 0,
      provider: input.provider,
      message: totalItems === 1 ? "Generating 1 visual anchor" : `Generating ${totalItems} visual anchors`,
    });
    logger.info("orchestrator_job.started", { totalItems, provider: input.provider });
    const auth = localAuth(input.workspaceId);
    const generatedAssetIds: string[] = [];

    for (let index = 0; index < input.visualAnchorPlan.anchors.length; index += 1) {
      const anchor = input.visualAnchorPlan.anchors[index];
      const role = anchor.kind === "character" ? "character_anchor" : "scene_anchor";
      const provider = providerForAnchor(anchor, input.provider);
      await jobs.reportProgress?.(input.jobId, {
        provider,
        currentItem: { id: anchor.id, label: anchor.label, index: index + 1 },
        message: `Generating anchor ${index + 1} of ${totalItems}: ${anchor.label}`,
      });
      logger.info("orchestrator_job.item_started", {
        itemId: anchor.id,
        itemIndex: index + 1,
        totalItems,
        provider,
      });
      const graphInputs: GraphAssetInput[] = [
        {
          assetId: input.visualAnchorPlanAssetId,
          relation: "input",
          role: "visual_anchor_plan",
          position: generatedAssetIds.length,
          ...(input.visualAnchorPlanContentHash
            ? { contentHash: input.visualAnchorPlanContentHash }
            : {}),
        },
      ];
      const assetIds = await generateAnchorAsset({
        deps: d,
        auth,
        projectId: input.projectId,
        anchor,
        role,
        provider,
        graphInputs,
        orchestratorRunId: input.orchestratorRunId,
      });
      if (assetIds.length === 0) {
        throw new Error(`Anchor generation returned no assets for ${anchor.id}.`);
      }
      for (const assetId of assetIds) {
        await d.selectGeneratedAnchorAsset({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          assetId,
          role,
          anchorId: anchor.id,
        });
        generatedAssetIds.push(assetId);
      }
      const completedItems = index + 1;
      await jobs.reportProgress?.(input.jobId, {
        completedItems,
        totalItems,
        percent: totalItems === 0 ? 100 : Math.round((completedItems / totalItems) * 100),
        lastProgressAt: new Date().toISOString(),
        currentItem: { id: anchor.id, label: anchor.label, index: completedItems },
        message: `Generated anchor ${completedItems} of ${totalItems}`,
      });
      logger.info("orchestrator_job.item_completed", {
        itemId: anchor.id,
        itemIndex: completedItems,
        totalItems,
        outputAssetIds: assetIds,
      });
    }

    await jobs.succeed(input.jobId, { assetIds: generatedAssetIds });
    logger.info("orchestrator_job.succeeded", {
      durationMs: Date.now() - startedAt,
      totalItems: input.visualAnchorPlan.anchors.length,
      outputAssetIds: generatedAssetIds,
    });
  } catch (err) {
    const safeError = redactError(err, { defaultCode: "job_failed" });
    await jobs.fail(input.jobId, {
      code: safeError.code,
      message: safeError.message,
    });
    logger.error("orchestrator_job.failed", {
      durationMs: Date.now() - startedAt,
      error: safeError,
    });
  } finally {
    stopHeartbeat();
    if (input.orchestratorRunId) {
      try {
        logger.info("orchestrator_resume.enqueue_started");
        await resume(d, input.orchestratorRunId, input.workspaceId);
        logger.info("orchestrator_resume.enqueued");
      } catch (error) {
        const safeError = redactError(error, { defaultCode: "resume_enqueue_failed" });
        logger.error("orchestrator_resume.enqueue_failed", {
          error: safeError,
        });
        // best-effort: durable run sweepers can resume a parked run later.
      }
    }
  }
}
