export type CatalogEntryKind = "character" | "story" | "image";
export type CatalogEntryStatus = "draft" | "published" | "archived";

export interface CatalogEntry {
  id: string;
  kind: CatalogEntryKind;
  status: CatalogEntryStatus;
  title: string;
  summary?: string | null;
  tags: string[];
  previewUrl?: string | null;
  snapshot?: Record<string, unknown>;
  useCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogMineResponse {
  entries: CatalogEntry[];
  pagination?: {
    limit: number;
    nextCursor: string | null;
  };
}

export interface PublishCatalogEntryInput {
  kind: CatalogEntryKind;
  sourceAssetId?: string;
  sourceStoryBlueprintId?: string;
  title: string;
  summary?: string;
  tags?: string[];
}

export interface PublishCatalogEntryResponse {
  entry: CatalogEntry;
}
