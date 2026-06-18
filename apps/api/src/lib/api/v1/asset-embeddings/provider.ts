import OpenAI from "openai";
import type { AssetEmbeddingConfig } from "./config";

export interface AssetEmbeddingProvider {
  embed(input: { text: string; config: AssetEmbeddingConfig }): Promise<number[]>;
}

export class OpenAIAssetEmbeddingProvider implements AssetEmbeddingProvider {
  private client: OpenAI | null = null;

  async embed(input: { text: string; config: AssetEmbeddingConfig }): Promise<number[]> {
    const client = this.client ?? new OpenAI();
    this.client = client;
    const response = await client.embeddings.create({
      model: input.config.model,
      input: input.text,
      dimensions: input.config.dimensions,
    });
    const embedding = response.data[0]?.embedding;
    if (!embedding || embedding.length !== input.config.dimensions) {
      throw new Error(
        `Embedding provider returned ${embedding?.length ?? 0} dimensions; expected ${input.config.dimensions}.`
      );
    }
    return embedding;
  }
}

export const defaultAssetEmbeddingProvider = new OpenAIAssetEmbeddingProvider();
