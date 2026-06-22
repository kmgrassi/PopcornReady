import { ApiError } from "./errors";
import { hasRuntimeProviderApiKey } from "@/lib/provider-api-keys";
import { assetEmbeddingConfig } from "./asset-embeddings/config";
import { defaultAssetEmbeddingProvider } from "./asset-embeddings/provider";
import type {
  AssetEmbeddingMedia,
  AssetSearchGraphKind,
  AssetSemanticSearchInput,
} from "./schemas";
import {
  searchProjectAssetsSemantic,
  searchPublicAssetsSemantic,
  searchPublicContent,
  type AssetSemanticSearchResult,
  type DiscoverSearchItem,
  type V1Asset,
} from "./store";

const PUBLIC_SEMANTIC_DISCOVERY_FLAG = "PUBLIC_ASSET_SEMANTIC_DISCOVERY_ENABLED";
const SEMANTIC_DISCOVERY_FETCH_LIMIT = 100;

export interface PublicDiscoverySearchInput {
  query: string;
  limit: number;
  cursor: string | null;
  kind?: AssetEmbeddingMedia;
  semantic?: boolean;
}

export interface AgentAssetRetrievalInput {
  workspaceId: string;
  projectId: string;
  query: string;
  limit?: number;
  media?: AssetEmbeddingMedia;
  kind?: AssetSearchGraphKind;
  role?: string;
}

export type AgentAssetRetrievalResult = AssetSemanticSearchResult;

export function publicSemanticDiscoveryEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env[PUBLIC_SEMANTIC_DISCOVERY_FLAG]?.trim().toLowerCase() === "true";
}

export async function searchPublicDiscovery(
  input: PublicDiscoverySearchInput
): Promise<{ items: DiscoverSearchItem[]; nextCursor: string | null }> {
  if (!input.semantic || !publicSemanticDiscoveryEnabled()) {
    return searchPublicContent(input.query, input.limit, input.cursor, input.kind);
  }

  const semanticInput = await buildSemanticSearchInput({
    query: input.query,
    limit: SEMANTIC_DISCOVERY_FETCH_LIMIT,
    media: input.kind,
  });
  if (!semanticInput) {
    return searchPublicContent(input.query, input.limit, input.cursor, input.kind);
  }

  const [textResults, semanticResults] = await Promise.all([
    searchPublicContent(input.query, SEMANTIC_DISCOVERY_FETCH_LIMIT, null, input.kind),
    searchPublicAssetsSemantic(semanticInput),
  ]);

  return paginateMergedDiscoveryResults(
    mergeDiscoveryResults(textResults.items, semanticResults.items),
    input.limit,
    input.cursor
  );
}

export async function retrieveAssetsForAgent(
  input: AgentAssetRetrievalInput
): Promise<AgentAssetRetrievalResult[]> {
  const semanticInput = await buildSemanticSearchInput(input, { requireProvider: true });
  if (!semanticInput) {
    throw new ApiError("internal_error", "Semantic retrieval provider was not configured.");
  }
  return (
    await searchProjectAssetsSemantic(input.workspaceId, input.projectId, semanticInput)
  ).items;
}

async function buildSemanticSearchInput(
  input: {
    query: string;
    limit?: number;
    media?: AssetEmbeddingMedia;
    kind?: AssetSearchGraphKind;
    role?: string;
  },
  options: { requireProvider?: boolean } = {}
): Promise<AssetSemanticSearchInput | null> {
  if (!(await hasRuntimeProviderApiKey("openai"))) {
    if (options.requireProvider) {
      throw new ApiError(
        "validation_failed",
        "OPENAI_API_KEY is required for semantic asset retrieval."
      );
    }
    return null;
  }

  const config = assetEmbeddingConfig();
  const queryEmbedding = await defaultAssetEmbeddingProvider.embed({
    text: input.query,
    config,
  });
  return {
    q: input.query,
    queryEmbedding,
    embeddingModel: config.model,
    limit: input.limit ?? 20,
    ...(input.media ? { media: input.media } : {}),
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.role ? { role: input.role } : {}),
  };
}

function mergeDiscoveryResults(
  textItems: DiscoverSearchItem[],
  semanticItems: AssetSemanticSearchResult[]
): DiscoverSearchItem[] {
  const merged = new Map<string, DiscoverSearchItem>();
  for (const item of semanticItems) {
    merged.set(`asset:${item.asset.id}`, {
      type: "asset",
      item: item.asset,
      id: `asset:${item.asset.id}`,
      createdAt: item.asset.createdAt,
      score: item.score.hybrid,
      source: "embedding",
    });
  }
  for (const item of textItems) {
    if (!merged.has(item.id)) merged.set(item.id, item);
  }
  return [...merged.values()];
}

function paginateMergedDiscoveryResults(
  items: DiscoverSearchItem[],
  limit: number,
  cursor: string | null
): { items: DiscoverSearchItem[]; nextCursor: string | null } {
  const startIndex = cursor
    ? Math.max(
        0,
        items.findIndex((item) => item.id === cursor) + 1
      )
    : 0;
  const page = items.slice(startIndex, startIndex + limit);
  const nextItem = items[startIndex + limit];
  return {
    items: page,
    nextCursor: nextItem ? page[page.length - 1]?.id ?? null : null,
  };
}

export type { AssetSemanticSearchResult, V1Asset };
