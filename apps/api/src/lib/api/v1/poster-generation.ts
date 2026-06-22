import { buildPosterPrompt } from "@/lib/generative/poster";
import type { AuthContext } from "./auth";
import type { GraphAssetInput } from "./asset-graph";
import { ApiError } from "./errors";
import { createGeneratedAsset } from "./generated-assets";
import type { V1Job } from "./jobs";
import { resolveWorkspaceGenerationModel } from "./model-settings";
import {
  findReusableGeneratedPoster,
  getAsset,
  getPosterGenerationContext,
  selectGeneratedProjectPoster,
  type PosterGenerationAssetRef,
  type V1Project,
} from "./store";
import type { VideoBrief } from "./schemas";

export interface GeneratePosterInput {
  force?: boolean;
  provider?: string;
  runId?: string;
}

export interface GeneratePosterResult {
  project: V1Project;
  poster: {
    assetId: string;
    generated: boolean;
    reused: boolean;
    selected: boolean;
    manuallyPinned: boolean;
  };
}

export interface GeneratePosterDeps {
  createGeneratedAsset: typeof createGeneratedAsset;
  getAsset: typeof getAsset;
  getPosterGenerationContext: typeof getPosterGenerationContext;
  findReusableGeneratedPoster: typeof findReusableGeneratedPoster;
  selectGeneratedProjectPoster: typeof selectGeneratedProjectPoster;
}

const defaultDeps: GeneratePosterDeps = {
  createGeneratedAsset,
  getAsset,
  getPosterGenerationContext,
  findReusableGeneratedPoster,
  selectGeneratedProjectPoster,
};

function assetInput(
  asset: PosterGenerationAssetRef,
  role: string,
  position: number,
  relation: GraphAssetInput["relation"] = "input"
): GraphAssetInput {
  return {
    assetId: asset.id,
    relation,
    role,
    position,
    ...(asset.contentHash ? { contentHash: asset.contentHash } : {}),
  };
}

function graphInputsForPoster(input: {
  briefAsset: PosterGenerationAssetRef;
  planAsset: PosterGenerationAssetRef | null;
  heroAnchorAsset: PosterGenerationAssetRef | null;
}): GraphAssetInput[] {
  const inputs = [assetInput(input.briefAsset, "brief", 0)];
  if (input.planAsset) inputs.push(assetInput(input.planAsset, "plan", inputs.length));
  if (input.heroAnchorAsset) {
    inputs.push(assetInput(input.heroAnchorAsset, "hero_anchor", inputs.length, "anchor"));
  }
  return inputs;
}

function summarizePlan(content: unknown): string | null {
  if (!content || typeof content !== "object") return null;
  const record = content as Record<string, unknown>;
  const candidates = [
    record.logline,
    record.summary,
    record.goal,
    record.title,
    record.description,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  const scenes = Array.isArray(record.scenes) ? record.scenes : [];
  const sceneNames = scenes
    .map((scene) =>
      scene && typeof scene === "object"
        ? String((scene as Record<string, unknown>).name ?? "").trim()
        : ""
    )
    .filter(Boolean)
    .slice(0, 3);
  return sceneNames.length ? sceneNames.join(" / ") : null;
}

function jobAssetId(job: V1Job): string {
  const result = job.result as { assetIds?: unknown } | null;
  const assetId = Array.isArray(result?.assetIds) ? result.assetIds[0] : null;
  if (typeof assetId !== "string" || assetId.length === 0) {
    throw new ApiError("job_failed", `Poster generation job did not return an asset id.`);
  }
  return assetId;
}

const MINOR_RE = /\b(baby|boy|child|girl|kid|minor|teen|teenage|toddler|youth)\b/i;

function textValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(textValues);
  return Object.values(value as Record<string, unknown>).flatMap(textValues);
}

function mentionsMinor(input: {
  brief: VideoBrief;
  planAsset: PosterGenerationAssetRef | null;
  heroAnchorAsset: PosterGenerationAssetRef | null;
}): boolean {
  const text = [
    ...textValues(input.brief),
    ...textValues(input.planAsset?.content),
    input.heroAnchorAsset?.description ?? "",
  ].join(" ");
  return MINOR_RE.test(text);
}

function providerName(input: {
  requestedProvider?: string;
  brief: VideoBrief;
  planAsset: PosterGenerationAssetRef | null;
  heroAnchorAsset: PosterGenerationAssetRef | null;
}): string | undefined {
  if (mentionsMinor(input)) return "gemini";
  return input.requestedProvider?.trim() || undefined;
}

export async function generatePoster(
  auth: AuthContext,
  projectId: string,
  input: GeneratePosterInput = {},
  deps: Partial<GeneratePosterDeps> = {}
): Promise<GeneratePosterResult> {
  const d = { ...defaultDeps, ...deps };
  const context = await d.getPosterGenerationContext(auth.workspaceId, projectId);
  if (!context.briefAsset) {
    throw new ApiError(
      "brief_missing",
      `Project ${projectId} needs a brief before a poster can be generated.`
    );
  }

  const brief = context.briefAsset.content as VideoBrief;
  const prompt = buildPosterPrompt({
    brief,
    planSummary: summarizePlan(context.planAsset?.content),
    heroAnchorDescription: context.heroAnchorAsset?.description,
  });
  const requestedOrSafetyProvider = providerName({
    requestedProvider: input.provider,
    brief,
    planAsset: context.planAsset,
    heroAnchorAsset: context.heroAnchorAsset,
  });
  const resolved = await resolveWorkspaceGenerationModel({
    workspaceId: auth.workspaceId,
    kind: "image",
    ...(requestedOrSafetyProvider ? { explicitProvider: requestedOrSafetyProvider } : {}),
  });
  const provider = resolved.provider;
  const graphInputs = graphInputsForPoster({
    briefAsset: context.briefAsset,
    planAsset: context.planAsset,
    heroAnchorAsset: context.heroAnchorAsset,
  });
  const inputAssetIds = graphInputs.map((graphInput) => graphInput.assetId).sort();

  if (!input.force) {
    const reusable = await d.findReusableGeneratedPoster({
      projectId,
      prompt,
      provider,
      inputAssetIds,
    });
    if (reusable) {
      const project = context.currentPosterManuallyPinned
        ? context.project
        : await d.selectGeneratedProjectPoster({
            workspaceId: auth.workspaceId,
            projectId,
            assetId: reusable.id,
          });
      return {
        project,
        poster: {
          assetId: reusable.id,
          generated: false,
          reused: true,
          selected: !context.currentPosterManuallyPinned,
          manuallyPinned: context.currentPosterManuallyPinned,
        },
      };
    }
  }

  const result = await d.createGeneratedAsset({
    auth,
    projectId,
    body: {
      kind: "image",
      provider,
      ...(resolved.model ? { model: resolved.model } : {}),
      prompt,
      description: "Generated project poster key art.",
      size: "1024x1536",
      assetRole: "poster",
      referenceAssetIds: context.heroAnchorAsset ? [context.heroAnchorAsset.id] : [],
      anchorIds: context.heroAnchorAsset ? [context.heroAnchorAsset.id] : [],
      graphInputs,
      ...(input.runId ? { runId: input.runId } : {}),
    },
  });
  const assetId = jobAssetId(result.body.job as V1Job);
  await d.getAsset(auth.workspaceId, projectId, assetId);

  const project = context.currentPosterManuallyPinned
    ? context.project
    : await d.selectGeneratedProjectPoster({
        workspaceId: auth.workspaceId,
        projectId,
        assetId,
      });
  return {
    project,
    poster: {
      assetId,
      generated: true,
      reused: false,
      selected: !context.currentPosterManuallyPinned,
      manuallyPinned: context.currentPosterManuallyPinned,
    },
  };
}
