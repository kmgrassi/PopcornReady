// Project catalog and activity persistence for the V1 store.

import type { ProjectStoryboard, V1Project } from "@popcorn/shared/v1/types";
import { runQuery } from "../../supabase/db-errors";
import { notFound } from "./errors";
import { paginate, paginateByUpdatedAt, type PageResult } from "./pagination";
import {
  getProjectStoryboard,
  getServiceSupabase,
  mapProjectWithProjection,
} from "./store";
import type { ProjectRow } from "./store";
import { getProjectWatchMedia } from "./store-asset-discovery";
import type { ProjectWatchMedia } from "./store-asset-discovery";

export async function recordProjectActivity(
  workspaceId: string,
  projectId: string
): Promise<void> {
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.recordProjectActivity",
    db
      .from("projects")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("id", projectId)
      .eq("workspace_id", workspaceId)
      .neq("status", "deleted")
      .select("id")
      .maybeSingle()
  );
  if (!data) throw notFound(`Project not found: ${projectId}`);
}

export async function listProjects(
  workspaceId: string,
  limit: number,
  cursor: string | null,
  order: "createdAt" | "updatedAt" = "createdAt"
): Promise<PageResult<V1Project>> {
  const db = getServiceSupabase();
  const data = await runQuery(
    "store.listProjects",
    db
      .from("projects")
      .select("*")
      .eq("workspace_id", workspaceId)
      .neq("status", "deleted")
  );
  const all = await Promise.all(
    (data as ProjectRow[]).map((row) => mapProjectWithProjection(db, row))
  );
  return order === "updatedAt"
    ? paginateByUpdatedAt(all, limit, cursor)
    : paginate(all, limit, cursor);
}

export async function listPublicProjects(
  limit: number,
  cursor: string | null,
  opts: { excludeWorkspaceId?: string } = {}
): Promise<PageResult<V1Project>> {
  const db = getServiceSupabase();
  let query = db
    .from("projects")
    .select("*, workspaces!inner(purpose)")
    .eq("visibility", "public")
    .eq("workspaces.purpose", "user")
    .neq("status", "deleted");
  // Filter before pagination so page sizes/cursors stay correct.
  if (opts.excludeWorkspaceId) {
    query = query.neq("workspace_id", opts.excludeWorkspaceId);
  }
  const data = await runQuery("store.listPublicProjects", query);
  const all = await Promise.all(
    (data as ProjectRow[]).map((row) =>
      mapProjectWithProjection(db, row, { publicOnly: true })
    )
  );
  return paginate(all, limit, cursor);
}

export async function getPublicProjectBundle(projectId: string): Promise<{
  project: V1Project;
  storyboard: ProjectStoryboard | null;
  media: ProjectWatchMedia | null;
} | null> {
  const db = getServiceSupabase();
  const row = await runQuery(
    "store.getPublicProject",
    db
      .from("projects")
      .select("*, workspaces!inner(purpose)")
      .eq("id", projectId)
      .eq("visibility", "public")
      .eq("workspaces.purpose", "user")
      .neq("status", "deleted")
      .maybeSingle()
  );
  if (!row) return null;
  const projectRow = row as ProjectRow;
  const [project, storyboard, media] = await Promise.all([
    mapProjectWithProjection(db, projectRow, { publicOnly: true }),
    getProjectStoryboard(projectRow.workspace_id, projectId),
    getProjectWatchMedia(projectRow.workspace_id, projectId),
  ]);
  return { project, storyboard, media };
}
