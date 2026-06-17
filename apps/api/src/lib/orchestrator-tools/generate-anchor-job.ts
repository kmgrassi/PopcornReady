import { agentApiStore, type AgentApiStore } from "@/lib/agent-api/jobs";
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
  jobs: Pick<AgentApiStore, "setStep" | "succeed" | "fail">;
  resumeOrchestratorRun?: (
    runId: string,
    deps: { workspaceId: string }
  ) => Promise<unknown>;
}

const defaultDeps: GenerateAnchorJobDeps = {
  generateCharacterAnchor: realGenerateCharacterAnchor,
  createGeneratedAsset: realCreateGeneratedAsset,
  selectGeneratedAnchorAsset: realSelectGeneratedAnchorAsset,
  jobs: agentApiStore,
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
  const fn =
    deps.resumeOrchestratorRun ??
    (await import("@/lib/orchestrator/engine")).resumeOrchestratorRun;
  await fn(runId, { workspaceId });
}

function mentionsMinor(anchor: VisualAnchorPlanItem): boolean {
  return /\b(baby|boy|child|girl|kid|minor|teen|toddler|youth)\b/i.test(
    `${anchor.label} ${anchor.description}`
  );
}

function providerForAnchor(
  anchor: VisualAnchorPlanItem,
  requestedProvider?: AnchorImageProvider
): AnchorImageProvider {
  if (requestedProvider) return requestedProvider;
  return mentionsMinor(anchor) ? "gemini" : "openai";
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
  provider: AnchorImageProvider;
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
        description: input.anchor.description,
        prompt,
        provider: input.provider,
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
      description: input.anchor.description,
      provider: input.provider,
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
  try {
    await d.jobs.setStep(input.jobId, "generating_assets");
    const auth = localAuth(input.workspaceId);
    const generatedAssetIds: string[] = [];

    for (const anchor of input.visualAnchorPlan.anchors) {
      const role = anchor.kind === "character" ? "character_anchor" : "scene_anchor";
      const provider = providerForAnchor(anchor, input.provider);
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
    }

    await d.jobs.succeed(input.jobId, { assetIds: generatedAssetIds });
  } catch (err) {
    await d.jobs.fail(input.jobId, {
      code: "job_failed",
      message: err instanceof Error ? err.message : String(err),
      requestId: "",
    });
  } finally {
    if (input.orchestratorRunId) {
      try {
        await resume(d, input.orchestratorRunId, input.workspaceId);
      } catch {
        // best-effort: durable run sweepers can resume a parked run later.
      }
    }
  }
}
