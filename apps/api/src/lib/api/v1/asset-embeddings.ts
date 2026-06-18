import {
  assetEmbeddingSourceHashMaterial,
  type AssetEmbeddingSourceChunk,
} from "@popcorn/shared/assets/embeddings";
import { sha256Hex } from "./asset-graph";

export function assetEmbeddingSourceHash(
  chunk: AssetEmbeddingSourceChunk
): string {
  return sha256Hex(assetEmbeddingSourceHashMaterial(chunk));
}
