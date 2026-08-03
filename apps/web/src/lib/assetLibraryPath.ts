export function assetLibraryPath(assetId: string, projectId?: string | null) {
  const params = new URLSearchParams({ assetId });
  if (projectId) params.set("projectId", projectId);
  return `/library/assets?${params.toString()}`;
}
