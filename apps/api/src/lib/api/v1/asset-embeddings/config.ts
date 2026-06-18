export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

export interface AssetEmbeddingConfig {
  model: string;
  dimensions: number;
}

export function assetEmbeddingConfig(env: NodeJS.ProcessEnv = process.env): AssetEmbeddingConfig {
  const model = (env.ASSET_EMBEDDING_MODEL || env.OPENAI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL).trim();
  const dimensionsRaw = (env.ASSET_EMBEDDING_DIMENSIONS || env.OPENAI_EMBEDDING_DIMENSIONS || "").trim();
  const dimensions = dimensionsRaw ? Number(dimensionsRaw) : DEFAULT_EMBEDDING_DIMENSIONS;
  if (!model) {
    throw new Error("Asset embedding model is empty.");
  }
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`Asset embedding dimensions must be a positive integer, got: ${dimensionsRaw}`);
  }
  if (dimensions !== DEFAULT_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Asset embedding dimensions must be ${DEFAULT_EMBEDDING_DIMENSIONS} until the asset_embeddings migration is changed.`
    );
  }
  return { model, dimensions };
}
