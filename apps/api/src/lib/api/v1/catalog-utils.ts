export function unmarked(value: Record<string, unknown> | null): Record<string, unknown> {
  if (!value) return {};
  const { schema_version: _schemaVersion, schema: _schema, ...rest } = value;
  void _schemaVersion;
  void _schema;
  return rest;
}

export function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length ? strings : undefined;
}

export function buildSearchText(parts: Array<string | undefined>): string {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 5000);
}

export function buildCatalogAssetSource(input: {
  catalogEntryId: string;
  sourceAssetId?: string | null;
  sourceStoryBlueprintId?: string | null;
}): Record<string, unknown> {
  return {
    type: "catalog",
    catalogEntryId: input.catalogEntryId,
    ...(input.sourceAssetId ? { sourceAssetId: input.sourceAssetId } : {}),
    ...(input.sourceStoryBlueprintId
      ? { sourceStoryBlueprintId: input.sourceStoryBlueprintId }
      : {}),
  };
}
