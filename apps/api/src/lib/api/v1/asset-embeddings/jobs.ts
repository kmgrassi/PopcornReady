import type { Job } from "@popcorn/shared/v1/types";
import { ApiError } from "../errors";
import {
  createJob,
  getAssetEmbeddingSource,
  getServiceSupabaseForStore,
  updateJob,
  type V1Asset,
  type V1AssetEmbeddingSource,
} from "../store";
import { assetEmbeddingConfig, type AssetEmbeddingConfig } from "./config";
import {
  buildAssetEmbeddingSourceChunks,
  type AssetEmbeddingSourceChunk,
} from "./source";
import {
  defaultAssetEmbeddingProvider,
  type AssetEmbeddingProvider,
} from "./provider";

export interface AssetEmbeddingJobInput {
  schemaVersion: "assetEmbeddingJob.v1";
  assetId: string;
  reason: "asset_ready" | "metadata_changed" | "backfill" | "retry";
  model: string;
  dimensions: number;
  sourceHashes: Record<string, string>;
}

export interface AssetEmbeddingJobResult {
  assetId: string;
  embeddedChunks: number;
  skippedChunks: number;
  model: string;
  dimensions: number;
}

export interface EnqueueAssetEmbeddingOptions {
  reason: AssetEmbeddingJobInput["reason"];
  startWorker?: boolean;
  provider?: AssetEmbeddingProvider;
  config?: AssetEmbeddingConfig;
}

type LoadAssetEmbeddingSource = (
  workspaceId: string,
  projectId: string,
  assetId: string
) => Promise<V1AssetEmbeddingSource>;

export async function loadAssetEmbeddingChunks(
  input: { workspaceId: string; projectId: string; assetId: string },
  loadSource: LoadAssetEmbeddingSource = getAssetEmbeddingSource
): Promise<{
  asset: V1AssetEmbeddingSource;
  chunks: AssetEmbeddingSourceChunk[];
}> {
  const asset = await loadSource(input.workspaceId, input.projectId, input.assetId);
  return { asset, chunks: buildAssetEmbeddingSourceChunks(asset) };
}

function vectorLiteral(values: number[]): string {
  return `[${values.map((value) => {
    if (!Number.isFinite(value)) throw new Error("Embedding vector contains a non-finite value.");
    return String(value);
  }).join(",")}]`;
}

async function existingSourceHashes(input: {
  asset: V1Asset;
  model: string;
}): Promise<Map<string, string>> {
  const db = getServiceSupabaseForStore();
  const { data, error } = await db
    .from("asset_embeddings")
    .select("chunk_key, source_hash")
    .eq("asset_id", input.asset.id)
    .eq("project_id", input.asset.projectId)
    .eq("workspace_id", input.asset.workspaceId)
    .eq("embedding_model", input.model);
  if (error) throw error;
  return new Map(
    ((data ?? []) as Array<{ chunk_key: string; source_hash: string }>).map((row) => [
      row.chunk_key,
      row.source_hash,
    ])
  );
}

export function staleAssetEmbeddingChunkKeys(
  existingChunkKeys: Iterable<string>,
  rebuiltChunks: AssetEmbeddingSourceChunk[]
): string[] {
  const rebuiltKeys = new Set(rebuiltChunks.map((chunk) => chunk.chunkKey));
  return [...existingChunkKeys].filter((chunkKey) => !rebuiltKeys.has(chunkKey));
}

async function deleteStaleAssetEmbeddingChunks(input: {
  asset: V1Asset;
  model: string;
  chunkKeys: string[];
}): Promise<void> {
  if (input.chunkKeys.length === 0) return;
  const db = getServiceSupabaseForStore();
  const { error } = await db
    .from("asset_embeddings")
    .delete()
    .eq("asset_id", input.asset.id)
    .eq("project_id", input.asset.projectId)
    .eq("workspace_id", input.asset.workspaceId)
    .eq("embedding_model", input.model)
    .in("chunk_key", input.chunkKeys);
  if (error) throw error;
}

function sourceHashes(chunks: AssetEmbeddingSourceChunk[]): Record<string, string> {
  return Object.fromEntries(chunks.map((chunk) => [chunk.chunkKey, chunk.sourceHash]));
}

export async function enqueueAssetEmbeddingRefresh(
  asset: V1Asset,
  options: EnqueueAssetEmbeddingOptions
): Promise<Job | null> {
  const config = options.config ?? assetEmbeddingConfig();
  const persisted = await loadAssetEmbeddingChunks({
    workspaceId: asset.workspaceId,
    projectId: asset.projectId,
    assetId: asset.id,
  });
  const chunks = persisted.chunks;
  const existing = await existingSourceHashes({ asset: persisted.asset, model: config.model });
  const staleChunkKeys = staleAssetEmbeddingChunkKeys(existing.keys(), chunks);
  await deleteStaleAssetEmbeddingChunks({
    asset: persisted.asset,
    model: config.model,
    chunkKeys: staleChunkKeys,
  });
  if (chunks.length === 0) return null;

  const changed = chunks.filter((chunk) => existing.get(chunk.chunkKey) !== chunk.sourceHash);
  if (changed.length === 0) return null;

  const job = await createJob({
    workspaceId: persisted.asset.workspaceId,
    projectId: persisted.asset.projectId,
    type: "asset_embedding",
    status: "queued",
    payload: {
      schemaVersion: "assetEmbeddingJob.v1",
      assetId: persisted.asset.id,
      reason: options.reason,
      model: config.model,
      dimensions: config.dimensions,
      sourceHashes: sourceHashes(changed),
    } satisfies AssetEmbeddingJobInput,
  });

  if (options.startWorker !== false) {
    const provider = options.provider ?? defaultAssetEmbeddingProvider;
    void processAssetEmbeddingJob({
      workspaceId: persisted.asset.workspaceId,
      projectId: persisted.asset.projectId,
      jobId: job.id,
      provider,
      config,
    }).catch(() => undefined);
  }
  return job;
}

function parseJobInput(job: Job): AssetEmbeddingJobInput {
  const input = job.input as Partial<AssetEmbeddingJobInput> | null;
  if (
    !input ||
    input.schemaVersion !== "assetEmbeddingJob.v1" ||
    typeof input.assetId !== "string" ||
    typeof input.model !== "string" ||
    typeof input.dimensions !== "number"
  ) {
    throw new ApiError("validation_failed", `Invalid asset embedding job input: ${job.id}`);
  }
  return input as AssetEmbeddingJobInput;
}

export async function processAssetEmbeddingJob(input: {
  workspaceId: string;
  projectId: string;
  jobId: string;
  provider?: AssetEmbeddingProvider;
  config?: AssetEmbeddingConfig;
}): Promise<Job> {
  const provider = input.provider ?? defaultAssetEmbeddingProvider;
  const running = await updateJob(input.workspaceId, input.projectId, input.jobId, {
    status: "running",
    progress: { currentStep: "embedding_asset", percent: 10 },
  });

  try {
    const jobInput = parseJobInput(running);
    const config = input.config ?? {
      model: jobInput.model,
      dimensions: jobInput.dimensions,
    };
    const persisted = await loadAssetEmbeddingChunks({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      assetId: jobInput.assetId,
    });
    const { asset, chunks } = persisted;
    const requestedHashes = new Map(Object.entries(jobInput.sourceHashes));
    const changed = chunks.filter(
      (chunk) => requestedHashes.get(chunk.chunkKey) === chunk.sourceHash
    );
    const db = getServiceSupabaseForStore();

    let embeddedChunks = 0;
    for (const chunk of changed) {
      const embedding = await provider.embed({ text: chunk.sourceText, config });
      const { error } = await db.from("asset_embeddings").upsert(
        {
          workspace_id: asset.workspaceId,
          project_id: asset.projectId,
          asset_id: asset.id,
          chunk_key: chunk.chunkKey,
          chunk_kind: chunk.chunkKind,
          embedding_model: config.model,
          embedding_dimensions: config.dimensions,
          source_hash: chunk.sourceHash,
          source_text: chunk.sourceText,
          embedding: vectorLiteral(embedding),
        },
        { onConflict: "asset_id,chunk_key,embedding_model" }
      );
      if (error) throw error;
      embeddedChunks += 1;
    }

    return updateJob(input.workspaceId, input.projectId, input.jobId, {
      status: "succeeded",
      progress: { currentStep: "completed", percent: 100 },
      result: {
        assetId: asset.id,
        embeddedChunks,
        skippedChunks: chunks.length - embeddedChunks,
        model: config.model,
        dimensions: config.dimensions,
      } satisfies AssetEmbeddingJobResult,
      error: null,
    });
  } catch (error) {
    return updateJob(input.workspaceId, input.projectId, input.jobId, {
      status: "failed",
      progress: { currentStep: "failed", percent: 100 },
      error: {
        code: "asset_embedding_failed",
        message: error instanceof Error ? error.message : "Asset embedding failed.",
      },
    });
  }
}
