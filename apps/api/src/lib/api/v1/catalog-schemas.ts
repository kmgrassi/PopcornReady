// Catalog request/response schemas and lightweight validators for the v1 agent API.

import { ApiError, validationError, type FieldError } from "./errors";
import { parsePagination } from "./schema-pagination";
import {
  isPlainObject,
  optionalString,
  optionalStringArray,
  requireString,
  throwIfInvalid,
} from "./schema-validation";

export type CatalogEntryKind = "character" | "story" | "image";
const CATALOG_ENTRY_KINDS: CatalogEntryKind[] = ["character", "story", "image"];
export type CatalogEntryStatus = "draft" | "published" | "archived";
const CATALOG_ENTRY_STATUSES: CatalogEntryStatus[] = [
  "draft",
  "published",
  "archived",
];

export interface PublishCatalogEntryInput {
  kind: CatalogEntryKind;
  sourceAssetId?: string;
  sourceStoryBlueprintId?: string;
  title: string;
  summary?: string;
  tags: string[];
  status: "draft" | "published";
}

export interface UpdateCatalogEntryInput {
  title?: string;
  summary?: string | null;
  tags?: string[];
  status?: CatalogEntryStatus;
}

export interface UseCatalogEntryInput {
  targetProjectId: string;
}



export function parseCatalogEntriesQuery(searchParams: URLSearchParams): {
  limit: number;
  cursor: string | null;
  kind?: CatalogEntryKind;
} {
  const { limit, cursor } = parsePagination(searchParams);
  const rawKind = searchParams.get("kind");
  if (rawKind !== null && !CATALOG_ENTRY_KINDS.includes(rawKind as CatalogEntryKind)) {
    throw new ApiError(
      "validation_failed",
      "kind must be one of: character, story, image.",
      { fields: [{ path: "kind", message: "Must be one of: character, story, image." }] }
    );
  }
  return { limit, cursor, ...(rawKind ? { kind: rawKind as CatalogEntryKind } : {}) };
}

export function parseCatalogSearchQuery(searchParams: URLSearchParams): {
  q: string;
  limit: number;
  cursor: string | null;
  kind?: CatalogEntryKind;
} {
  const q = searchParams.get("q")?.trim();
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
  return { q, ...parseCatalogEntriesQuery(searchParams) };
}

export function parsePublishCatalogEntry(body: unknown): PublishCatalogEntryInput {
  const fields: FieldError[] = [];
  if (!isPlainObject(body)) {
    throw validationError("The request body is invalid.", [
      { path: "$", message: "Must be an object." },
    ]);
  }
  const kind = requireString(body.kind, "kind", fields) as CatalogEntryKind | undefined;
  if (kind && !CATALOG_ENTRY_KINDS.includes(kind)) {
    fields.push({ path: "kind", message: "Must be one of: character, story, image." });
  }
  const sourceAssetId = optionalString(body.sourceAssetId, "sourceAssetId", fields);
  const sourceStoryBlueprintId = optionalString(
    body.sourceStoryBlueprintId,
    "sourceStoryBlueprintId",
    fields
  );
  const title = requireString(body.title, "title", fields);
  const summary = optionalString(body.summary, "summary", fields);
  const tags = optionalStringArray(body.tags, "tags", fields) ?? [];
  const status = optionalString(body.status, "status", fields) ?? "published";
  if (status !== "published") {
    fields.push({
      path: "status",
      message: 'Publishing catalog entries must use "published". Draft previews are not supported yet.',
    });
  }
  if (kind === "story") {
    if (!sourceStoryBlueprintId) {
      fields.push({
        path: "sourceStoryBlueprintId",
        message: "Story catalog entries require sourceStoryBlueprintId.",
      });
    }
    if (sourceAssetId) {
      fields.push({ path: "sourceAssetId", message: "Story entries cannot use sourceAssetId." });
    }
  } else if (kind === "character" || kind === "image") {
    if (!sourceAssetId) {
      fields.push({
        path: "sourceAssetId",
        message: "Character and image catalog entries require sourceAssetId.",
      });
    }
    if (sourceStoryBlueprintId) {
      fields.push({
        path: "sourceStoryBlueprintId",
        message: "Asset entries cannot use sourceStoryBlueprintId.",
      });
    }
  }
  throwIfInvalid(fields);
  return {
    kind: kind!,
    ...(sourceAssetId ? { sourceAssetId } : {}),
    ...(sourceStoryBlueprintId ? { sourceStoryBlueprintId } : {}),
    title: title!,
    ...(summary ? { summary } : {}),
    tags,
    status: status as "draft" | "published",
  };
}

export function parseUpdateCatalogEntry(body: unknown): UpdateCatalogEntryInput {
  const fields: FieldError[] = [];
  if (!isPlainObject(body)) {
    throw validationError("The request body is invalid.", [
      { path: "$", message: "Must be an object." },
    ]);
  }
  const title = optionalString(body.title, "title", fields);
  const summary =
    body.summary === null ? null : optionalString(body.summary, "summary", fields);
  const tags = optionalStringArray(body.tags, "tags", fields);
  const status = optionalString(body.status, "status", fields) as
    | CatalogEntryStatus
    | undefined;
  if (status && (!CATALOG_ENTRY_STATUSES.includes(status) || status === "draft")) {
    fields.push({ path: "status", message: 'Must be "published" or "archived".' });
  }
  throwIfInvalid(fields);
  return {
    ...(title !== undefined ? { title } : {}),
    ...(summary !== undefined ? { summary } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(status !== undefined ? { status } : {}),
  };
}

export function parseUseCatalogEntry(body: unknown): UseCatalogEntryInput {
  const fields: FieldError[] = [];
  if (!isPlainObject(body)) {
    throw validationError("The request body is invalid.", [
      { path: "$", message: "Must be an object." },
    ]);
  }
  const targetProjectId = requireString(body.targetProjectId, "targetProjectId", fields);
  throwIfInvalid(fields);
  return { targetProjectId: targetProjectId! };
}

