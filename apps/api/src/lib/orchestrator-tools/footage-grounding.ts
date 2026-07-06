import { listAssets as realListAssets, type V1Asset } from "@/lib/api/v1/store";
import type { GraphAssetInput } from "@/lib/api/v1/asset-graph";
import type { UsableMoment } from "@popcorn/shared/v1/types";

export interface FootageGroundingExcerpt {
  assetId: string;
  contentHash?: string;
  label: string;
  transcript?: string;
  moments: {
    startSec: number;
    endSec: number;
    label: string;
    description?: string;
  }[];
}

export interface FootageGroundingContext {
  excerpts: FootageGroundingExcerpt[];
  promptText: string | null;
}

function truncate(text: string, max = 700): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trim()}...`;
}

function assetLabel(asset: V1Asset): string {
  return asset.name || asset.userContext?.title || asset.filename || asset.id;
}

function transcriptFor(asset: V1Asset): string | undefined {
  const text =
    asset.context?.transcriptText ||
    asset.agentContext?.transcriptSummary ||
    asset.userContext?.transcriptHint;
  return text?.trim() ? truncate(text) : undefined;
}

function momentsFor(asset: V1Asset): FootageGroundingExcerpt["moments"] {
  const contextMoments =
    asset.context?.moments?.map((moment) => ({
      startSec: moment.startSec,
      endSec: moment.endSec,
      label: moment.label || "source moment",
    })) ?? [];
  const usableMoments =
    asset.agentContext && "usableMoments" in asset.agentContext
      ? ((asset.agentContext as { usableMoments?: UsableMoment[] }).usableMoments ?? []).map(
          (moment) => ({
            startSec: moment.startSec,
            endSec: moment.endSec,
            label: moment.label,
            description: moment.description,
          })
        )
      : [];
  return [...contextMoments, ...usableMoments]
    .filter((moment) => Number.isFinite(moment.startSec) && Number.isFinite(moment.endSec))
    .slice(0, 6);
}

export function buildFootageGroundingPrompt(excerpts: FootageGroundingExcerpt[]): string | null {
  if (excerpts.length === 0) return null;
  const lines = [
    "Footage grounding from uploaded assets:",
    "Use these transcript excerpts and source windows when they are relevant. Prefer real names, quotes, and event timing over invented narration. If a beat maps to a source window, include sourceWindow { assetId, startSec, endSec, label } on that beat.",
  ];
  for (const excerpt of excerpts) {
    lines.push(`- ${excerpt.label} (${excerpt.assetId})`);
    if (excerpt.transcript) lines.push(`  transcript: "${excerpt.transcript}"`);
    for (const moment of excerpt.moments) {
      const description = moment.description ? ` — ${moment.description}` : "";
      lines.push(
        `  moment ${moment.startSec.toFixed(2)}-${moment.endSec.toFixed(2)}s: ${moment.label}${description}`
      );
    }
  }
  return lines.join("\n");
}

export async function buildFootageGroundingContext(input: {
  workspaceId: string;
  projectId: string;
  listAssets?: typeof realListAssets;
}): Promise<FootageGroundingContext> {
  const listAssets = input.listAssets ?? realListAssets;
  const assets = await listAssets(input.workspaceId, input.projectId, 1000, null);
  const excerpts = assets.items
    .filter((asset) => asset.kind === "video" || asset.kind === "audio")
    .map((asset) => ({
      assetId: asset.id,
      contentHash: asset.contentHash,
      label: assetLabel(asset),
      transcript: transcriptFor(asset),
      moments: momentsFor(asset),
    }))
    .filter((excerpt) => excerpt.transcript || excerpt.moments.length > 0)
    .slice(0, 8);
  return {
    excerpts,
    promptText: buildFootageGroundingPrompt(excerpts),
  };
}

export function groundingGraphInputs(
  grounding: FootageGroundingContext,
  startPosition: number
): GraphAssetInput[] {
  const seen = new Set<string>();
  const inputs: GraphAssetInput[] = [];
  for (const excerpt of grounding.excerpts) {
    if (!excerpt.assetId || seen.has(excerpt.assetId)) continue;
    seen.add(excerpt.assetId);
    inputs.push({
      assetId: excerpt.assetId,
      relation: "input",
      role: "footage_grounding",
      position: startPosition + inputs.length,
      ...(excerpt.contentHash ? { contentHash: excerpt.contentHash } : {}),
    });
  }
  return inputs;
}
