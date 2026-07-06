export const UPLOADED_FOOTAGE_ENTRYPOINT = "uploaded-footage";

export interface UploadedFootageRunMetadata {
  entrypoint: typeof UPLOADED_FOOTAGE_ENTRYPOINT;
  assetIds: string[];
}

function orderedUnique(values: string[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of values) {
    const id = value.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function uploadedFootageMetadata(assetIds: string[]): UploadedFootageRunMetadata {
  return {
    entrypoint: UPLOADED_FOOTAGE_ENTRYPOINT,
    assetIds: orderedUnique(assetIds),
  };
}

export function uploadedFootageMetadataFromSummary(
  inputSummary: string
): UploadedFootageRunMetadata | undefined {
  const selectedLine = inputSummary
    .split(/\r?\n/)
    .find((line) => line.startsWith("selectedAssetIds="));
  if (!selectedLine) return undefined;
  const assetIds = orderedUnique(selectedLine.slice("selectedAssetIds=".length).split(","));
  return assetIds.length ? uploadedFootageMetadata(assetIds) : undefined;
}

export function selectedUploadedFootageAssetIds(
  metadata: Record<string, unknown> | undefined
): string[] | undefined {
  if (!metadata || metadata.entrypoint !== UPLOADED_FOOTAGE_ENTRYPOINT) return undefined;
  const raw = metadata.assetIds;
  if (!Array.isArray(raw)) return undefined;
  const assetIds = orderedUnique(raw.map(String));
  return assetIds.length ? assetIds : undefined;
}
