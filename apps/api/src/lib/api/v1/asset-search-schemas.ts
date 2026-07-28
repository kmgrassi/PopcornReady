// Asset semantic-search schemas and lightweight validators for the v1 agent API.

import { ApiError } from "./errors";

export type AssetEmbeddingMedia = "image" | "video" | "audio";
const ASSET_EMBEDDING_MEDIA: AssetEmbeddingMedia[] = ["image", "video", "audio"];
export type AssetSearchGraphKind =
  | "source_footage"
  | "image"
  | "anchor"
  | "keyframe"
  | "clip"
  | "audio_track"
  | "render"
  | "poster";
const ASSET_SEARCH_GRAPH_KINDS: AssetSearchGraphKind[] = [
  "source_footage",
  "image",
  "anchor",
  "keyframe",
  "clip",
  "audio_track",
  "render",
  "poster",
];
export const ASSET_EMBEDDING_DIMENSIONS = 1536;

export interface AssetSemanticSearchInput {
  q: string;
  queryEmbedding: number[];
  limit: number;
  embeddingModel: string;
  media?: AssetEmbeddingMedia;
  kind?: AssetSearchGraphKind;
  role?: string;
}

export function parseAssetSemanticSearch(body: unknown): AssetSemanticSearchInput {
  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  if (!record) {
    throw new ApiError("validation_failed", "Request body must be an object.");
  }

  const q = typeof record.q === "string" ? record.q.trim() : "";
  if (!q) {
    throw new ApiError("validation_failed", "q is required.", {
      fields: [{ path: "q", message: "Must be a non-empty search query." }],
    });
  }
  if (q.length > 200) {
    throw new ApiError("validation_failed", "q must be 200 characters or fewer.", {
      fields: [{ path: "q", message: "Must be 200 characters or fewer." }],
    });
  }

  const queryEmbedding = record.queryEmbedding;
  if (!Array.isArray(queryEmbedding)) {
    throw new ApiError("validation_failed", "queryEmbedding is required.", {
      fields: [{ path: "queryEmbedding", message: "Must be an embedding vector." }],
    });
  }
  if (queryEmbedding.length !== ASSET_EMBEDDING_DIMENSIONS) {
    throw new ApiError(
      "validation_failed",
      `queryEmbedding must contain ${ASSET_EMBEDDING_DIMENSIONS} dimensions.`,
      {
        fields: [
          {
            path: "queryEmbedding",
            message: `Must contain ${ASSET_EMBEDDING_DIMENSIONS} numeric dimensions.`,
          },
        ],
      }
    );
  }
  const invalidIndex = queryEmbedding.findIndex(
    (value) => typeof value !== "number" || !Number.isFinite(value)
  );
  if (invalidIndex !== -1) {
    throw new ApiError("validation_failed", "queryEmbedding must contain only numbers.", {
      fields: [
        {
          path: `queryEmbedding.${invalidIndex}`,
          message: "Must be a finite number.",
        },
      ],
    });
  }

  const rawLimit = record.limit;
  const limit = rawLimit === undefined ? 20 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ApiError("validation_failed", "limit must be an integer between 1 and 100.", {
      fields: [{ path: "limit", message: "Must be an integer between 1 and 100." }],
    });
  }

  const embeddingModel =
    typeof record.embeddingModel === "string" ? record.embeddingModel.trim() : undefined;
  if (!embeddingModel) {
    throw new ApiError("validation_failed", "embeddingModel is required.", {
      fields: [{ path: "embeddingModel", message: "Must be a non-empty embedding model." }],
    });
  }

  const media = record.media;
  if (media !== undefined && !ASSET_EMBEDDING_MEDIA.includes(media as AssetEmbeddingMedia)) {
    throw new ApiError("validation_failed", "media must be one of: image, video, audio.", {
      fields: [{ path: "media", message: "Must be one of: image, video, audio." }],
    });
  }

  const kind = record.kind;
  if (kind !== undefined && !ASSET_SEARCH_GRAPH_KINDS.includes(kind as AssetSearchGraphKind)) {
    throw new ApiError("validation_failed", "kind is not a supported searchable media asset kind.", {
      fields: [{ path: "kind", message: "Must be a supported searchable media asset kind." }],
    });
  }

  const role = typeof record.role === "string" ? record.role.trim() : undefined;
  if (role !== undefined && role.length === 0) {
    throw new ApiError("validation_failed", "role must be non-empty.", {
      fields: [{ path: "role", message: "Must be non-empty when provided." }],
    });
  }

  return {
    q,
    queryEmbedding: queryEmbedding as number[],
    limit,
    embeddingModel,
    ...(media ? { media: media as AssetEmbeddingMedia } : {}),
    ...(kind ? { kind: kind as AssetSearchGraphKind } : {}),
    ...(role ? { role } : {}),
  };
}

