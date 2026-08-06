import { createHash } from "crypto";
import type { AssetSemanticAnalysis } from "@/lib/assets/semantic-analysis";
import type { V1Asset, V1AssetEmbeddingSource } from "../store";

export type AssetEmbeddingChunkKind = "asset_summary" | "transcript" | "planning";

export interface AssetEmbeddingSourceChunk {
  chunkKey: string;
  chunkKind: AssetEmbeddingChunkKind;
  sourceText: string;
  sourceHash: string;
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function addLine(lines: string[], label: string, value: unknown): void {
  if (typeof value === "string" && value.trim()) {
    lines.push(`${label}: ${value.trim()}`);
  } else if (Array.isArray(value) && value.length > 0) {
    const compact = value.map((item) => String(item).trim()).filter(Boolean);
    if (compact.length) lines.push(`${label}: ${compact.join(", ")}`);
  }
}

function textChunk(
  chunkKey: string,
  chunkKind: AssetEmbeddingChunkKind,
  lines: string[]
): AssetEmbeddingSourceChunk | null {
  const sourceText = lines.map((line) => line.trim()).filter(Boolean).join("\n");
  if (!sourceText) return null;
  return {
    chunkKey,
    chunkKind,
    sourceText,
    sourceHash: hashText(sourceText),
  };
}

function semanticText(analysis: AssetSemanticAnalysis | undefined): string[] {
  if (!analysis) return [];
  const lines: string[] = [];
  for (const segment of analysis.segments ?? []) {
    addLine(lines, "Visual description", segment.visualDescription);
    addLine(lines, "Semantic tags", segment.semanticTags);
  }
  return lines;
}

function transcriptText(asset: V1Asset): string | undefined {
  return (
    asset.context?.transcriptText ||
    asset.userContext?.transcriptHint ||
    asset.agentContext?.transcriptSummary ||
    asset.semanticAnalysis?.transcript?.map((segment) => segment.text).join("\n")
  );
}

function summaryLines(asset: V1AssetEmbeddingSource): string[] {
  const meaningful: string[] = [];
  addLine(meaningful, "Role", asset.role);
  addLine(meaningful, "Description", asset.userContext?.description);
  addLine(meaningful, "Title", asset.userContext?.title);
  addLine(meaningful, "Summary", asset.context?.summary);
  addLine(meaningful, "Agent summary", asset.agentContext?.summary);
  addLine(meaningful, "Knowledge summary", asset.assetKnowledge?.knowledgeSummary);
  addLine(meaningful, "Clip summary", asset.clipUnderstanding?.combinedSummary);
  addLine(meaningful, "People", asset.userContext?.people);
  addLine(meaningful, "Characters", asset.userContext?.characterNames);
  addLine(meaningful, "Location", asset.userContext?.location);
  addLine(meaningful, "Event", asset.userContext?.event);
  addLine(meaningful, "Notable moments", asset.userContext?.notableMoments);
  addLine(meaningful, "Tags", asset.userContext?.tags);
  addLine(meaningful, "Intended uses", asset.userContext?.intendedUse);
  addLine(meaningful, "Recommended roles", asset.context?.recommendedRoles);
  addLine(meaningful, "Likely uses", asset.agentContext?.likelyUses);
  addLine(meaningful, "Subjects", asset.agentContext?.subjects);
  addLine(meaningful, "Actions", asset.agentContext?.actions);
  addLine(meaningful, "Setting", asset.agentContext?.setting);
  addLine(meaningful, "Mood", asset.agentContext?.mood);
  addLine(meaningful, "Audio notes", asset.userContext?.audioNotes);
  addLine(meaningful, "Generation prompt", asset.provenance?.prompt);
  addLine(meaningful, "Provider", asset.provenance?.provider);
  addLine(meaningful, "Model", asset.provenance?.model);
  meaningful.push(...semanticText(asset.semanticAnalysis));
  if (meaningful.length === 0) return [];

  const lines: string[] = [
    `Asset kind: ${asset.kind}`,
    `Graph kind: ${asset.graphKind}`,
  ];
  addLine(lines, "Filename", asset.filename);
  lines.push(...meaningful);
  return lines;
}

function isEligible(asset: V1AssetEmbeddingSource): boolean {
  if (asset.status !== "ready") return false;
  if (asset.graphKind === "source_footage") return asset.media !== "data";
  if (
    asset.graphKind === "image" ||
    asset.graphKind === "anchor" ||
    asset.graphKind === "keyframe" ||
    asset.graphKind === "poster"
  ) {
    return asset.media === "image";
  }
  if (asset.graphKind === "clip") return asset.media === "video";
  if (asset.graphKind === "audio_track") return asset.media === "audio";
  return false;
}

export function buildAssetEmbeddingSourceChunks(
  asset: V1AssetEmbeddingSource
): AssetEmbeddingSourceChunk[] {
  if (!isEligible(asset)) return [];
  const chunks: AssetEmbeddingSourceChunk[] = [];
  const summary = textChunk("asset.summary", "asset_summary", summaryLines(asset));
  if (summary) chunks.push(summary);

  const transcript = transcriptText(asset);
  if (!transcript) return chunks;
  const transcriptChunk = textChunk("asset.transcript", "transcript", [
    `Asset kind: ${asset.kind}`,
    `Filename: ${asset.filename}`,
    `Transcript: ${transcript}`,
  ]);
  if (transcriptChunk) chunks.push(transcriptChunk);
  return chunks;
}
