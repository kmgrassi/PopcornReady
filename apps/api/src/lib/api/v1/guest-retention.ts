import { databaseError, runQuery } from "@/lib/supabase/db-errors";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { rootLogger, type Logger } from "@/lib/v1/logger";
import { readStorageConfig, visibilityForBucket } from "@/lib/storage/config";
import { createObjectStore, type ObjectStore } from "@/lib/storage/object-store";

export const GUEST_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ClaimedGuestProjectObject {
  projectId: string;
  workspaceId: string;
  lastActivityAt: string;
  storageBucket: string | null;
  storageKey: string | null;
  estimatedBytes: number;
  deletedAssetCount: number;
}

interface ClaimedGuestProjectObjectRow {
  project_id: string;
  workspace_id: string;
  last_activity_at: string;
  storage_bucket: string | null;
  storage_key: string | null;
  estimated_bytes: number | string | null;
  deleted_asset_count: number | string | null;
}

interface PurgedGuestProjectRow {
  project_id: string;
  workspace_id: string;
  deleted_asset_count: number;
}

export interface GuestRetentionPurgeResult {
  cutoffIso: string;
  claimedProjectCount: number;
  purgedProjectCount: number;
  deletedAssetCount: number;
  deletedObjectCount: number;
  reclaimedBytes: number;
  failedObjectCount: number;
  retainedForRetryProjectCount: number;
}

export function guestRetentionCutoff(now = new Date()): Date {
  return new Date(now.getTime() - GUEST_RETENTION_DAYS * DAY_MS);
}

export function isGuestRetentionSchedulerEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (env.GUEST_RETENTION_PURGE_ENABLED ?? "").toLowerCase() === "true";
}

export function isGuestRetentionRunOnStartEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (env.GUEST_RETENTION_PURGE_RUN_ON_START ?? "").toLowerCase() === "true";
}

export function isGuestRetentionJobAuthorized(
  headerValue: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const expected = (env.GUEST_RETENTION_JOB_TOKEN ?? "").trim();
  if (!expected) return false;
  const actual = (headerValue ?? "").trim();
  return actual === `Bearer ${expected}` || actual === expected;
}

export function mapClaimedGuestProjectObject(
  row: ClaimedGuestProjectObjectRow
): ClaimedGuestProjectObject {
  return {
    projectId: row.project_id,
    workspaceId: row.workspace_id,
    lastActivityAt: new Date(row.last_activity_at).toISOString(),
    storageBucket: row.storage_bucket,
    storageKey: row.storage_key,
    estimatedBytes: Number(row.estimated_bytes ?? 0) || 0,
    deletedAssetCount: Number(row.deleted_asset_count ?? 0) || 0,
  };
}

export function projectIdsReadyForHardPurge(
  claimedProjectIds: Iterable<string>,
  failedProjectIds: Iterable<string>
): string[] {
  const failed = new Set(failedProjectIds);
  return [...new Set(claimedProjectIds)].filter((projectId) => !failed.has(projectId));
}

export async function claimExpiredGuestProjectObjects(
  cutoff: Date,
  limit = 100
): Promise<ClaimedGuestProjectObject[]> {
  const db = getServiceSupabase();
  const rows = await runQuery(
    "guestRetention.claimExpiredGuestProjectObjects",
    db.rpc("claim_expired_anonymous_projects", {
      p_before: cutoff.toISOString(),
      p_limit: limit,
    })
  );
  return ((rows ?? []) as ClaimedGuestProjectObjectRow[]).map(
    mapClaimedGuestProjectObject
  );
}

export async function runGuestRetentionPurge(
  options: {
    now?: Date;
    store?: ObjectStore;
    logger?: Logger;
  } = {}
): Promise<GuestRetentionPurgeResult> {
  const cutoff = guestRetentionCutoff(options.now);
  const logger = options.logger ?? rootLogger;
  const config = readStorageConfig();
  const store = options.store ?? createObjectStore(config);
  const objects = await claimExpiredGuestProjectObjects(cutoff);

  let deletedObjectCount = 0;
  let failedObjectCount = 0;
  let reclaimedBytes = 0;
  const seenObjects = new Set<string>();
  const claimedProjectIds = new Set(objects.map((object) => object.projectId));
  const failedProjectIds = new Set<string>();

  for (const object of objects) {
    if (!object.storageBucket || !object.storageKey) continue;

    const dedupeKey = `${object.storageBucket}/${object.storageKey}`;
    if (seenObjects.has(dedupeKey)) continue;
    seenObjects.add(dedupeKey);

    try {
      await store.deleteObject(
        object.storageKey,
        visibilityForBucket(config, object.storageBucket)
      );
      deletedObjectCount += 1;
      reclaimedBytes += object.estimatedBytes;
    } catch (error) {
      failedObjectCount += 1;
      failedProjectIds.add(object.projectId);
      logger.warn("guest_retention.object_delete_failed", {
        projectId: object.projectId,
        storageBucket: object.storageBucket,
        storageKey: object.storageKey,
        error: {
          message: error instanceof Error ? error.message : "Object delete failed.",
        },
      });
    }
  }

  const purgeProjectIds = projectIdsReadyForHardPurge(
    claimedProjectIds,
    failedProjectIds
  );
  const purgedRows =
    purgeProjectIds.length > 0 ? await purgeExpiredGuestProjects(purgeProjectIds) : [];
  const result: GuestRetentionPurgeResult = {
    cutoffIso: cutoff.toISOString(),
    claimedProjectCount: claimedProjectIds.size,
    purgedProjectCount: purgedRows.length,
    deletedAssetCount: purgedRows.reduce(
      (total, row) => total + Number(row.deleted_asset_count ?? 0),
      0
    ),
    deletedObjectCount,
    reclaimedBytes,
    failedObjectCount,
    retainedForRetryProjectCount: failedProjectIds.size,
  };

  logger.info("guest_retention.purged_projects", {
    cutoffIso: result.cutoffIso,
    claimedProjectCount: result.claimedProjectCount,
    purgedProjectCount: result.purgedProjectCount,
    deletedAssetCount: result.deletedAssetCount,
    deletedObjectCount: result.deletedObjectCount,
    reclaimedBytes: result.reclaimedBytes,
    failedObjectCount: result.failedObjectCount,
    retainedForRetryProjectCount: result.retainedForRetryProjectCount,
  });
  return result;
}

async function purgeExpiredGuestProjects(
  projectIds: string[]
): Promise<PurgedGuestProjectRow[]> {
  const db = getServiceSupabase();
  const { data, error } = await db.rpc("purge_expired_anonymous_projects", {
    p_project_ids: projectIds,
  });
  if (error) throw databaseError("guestRetention.purgeExpiredGuestProjects", error);
  return (data ?? []) as PurgedGuestProjectRow[];
}

export function startGuestRetentionScheduler(
  options: { logger?: Logger } = {}
): NodeJS.Timeout | null {
  if (!isGuestRetentionSchedulerEnabled()) return null;

  const logger = options.logger ?? rootLogger;
  const run = () => {
    runGuestRetentionPurge({ logger }).catch((error) => {
      logger.error("guest_retention.purge_failed", {
        error: {
          message: error instanceof Error ? error.message : "Guest retention purge failed.",
        },
      });
    });
  };

  if (isGuestRetentionRunOnStartEnabled()) run();

  const timer = setInterval(run, DAY_MS);
  timer.unref();
  logger.info("guest_retention.scheduler_started", {
    intervalMs: DAY_MS,
    runOnStart: isGuestRetentionRunOnStartEnabled(),
  });
  return timer;
}
