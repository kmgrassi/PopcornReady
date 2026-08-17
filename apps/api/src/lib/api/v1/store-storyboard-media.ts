// Asset lineage resolution for storyboard scene and panel media.

import type { SupabaseClient } from "@supabase/supabase-js";
import { runQuery } from "../../supabase/db-errors";
import { assetMediaUrlsForRow } from "./asset-media-urls";
import type { AssetRow } from "./store";

export function assetGenerationPrompt(row: Pick<AssetRow, "params">): string | undefined {
  const prompt = row.params?.provenance?.prompt?.trim();
  return prompt || undefined;
}

// Resolve a set of storyboard media asset ids to deliverable URLs by following
// each asset's lineage HEAD (the newest ready media version).
export async function resolveStoryboardMediaByAssetId(
  db: SupabaseClient,
  workspaceId: string,
  projectId: string,
  assetIds: string[]
): Promise<Map<string, { url: string | null; thumbnailUrl: string | null; prompt?: string }>> {
  const result = new Map<
    string,
    { url: string | null; thumbnailUrl: string | null; prompt?: string }
  >();
  const ids = [...new Set(assetIds.filter(Boolean))];
  if (ids.length === 0) return result;

  // Map each referenced asset id to its lineage.
  const refRows = await runQuery(
    "store.resolvePanelMediaByAssetId refs",
    db
      .from("assets")
      .select("id, lineage_id")
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .in("id", ids)
  );
  const lineageByAssetId = new Map<string, string>();
  for (const row of (refRows ?? []) as Array<{ id: string; lineage_id: string }>) {
    lineageByAssetId.set(row.id, row.lineage_id);
  }
  const lineageIds = [...new Set(lineageByAssetId.values())];
  if (lineageIds.length === 0) return result;

  // Pull every ready media version in those lineages; the first per lineage in
  // version-desc order is the head.
  const headRows = await runQuery(
    "store.resolvePanelMediaByAssetId heads",
    db
      .from("assets")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("project_id", projectId)
      .in("lineage_id", lineageIds)
      .neq("media", "data")
      .eq("status", "ready")
      .order("version", { ascending: false })
  );
  const headByLineage = new Map<string, AssetRow>();
  for (const row of (headRows ?? []) as Array<AssetRow & { lineage_id: string }>) {
    if (!headByLineage.has(row.lineage_id)) headByLineage.set(row.lineage_id, row);
  }

  const mediaByLineage = new Map<
    string,
    { url: string | null; thumbnailUrl: string | null; prompt?: string }
  >();
  await Promise.all(
    [...headByLineage.entries()].map(async ([lineageId, row]) => {
      const media = await assetMediaUrlsForRow(row);
      mediaByLineage.set(lineageId, {
        url: media.url,
        thumbnailUrl: media.thumbnailUrl ?? null,
        prompt: assetGenerationPrompt(row),
      });
    })
  );

  for (const [assetId, lineageId] of lineageByAssetId.entries()) {
    const media = mediaByLineage.get(lineageId);
    if (media) result.set(assetId, media);
  }
  return result;
}
