import { databaseError, runQuery } from "@/lib/supabase/db-errors";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { rootLogger, type Logger } from "@/lib/v1/logger";
import { readStorageConfig, visibilityForBucket } from "@/lib/storage/config";
import { createObjectStore, type ObjectStore } from "@/lib/storage/object-store";

export const GUEST_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ExpiredGuestProjectObject {
  projectId: string;
  workspaceId: string;
  lastActivityAt: string;
  storageBucket: string | null;
  storageKey: string | null;
  estimatedBytes: number;
}

interface ExpiredGuestProjectObjectRow {
  project_id: string;
  workspace_id: string;
  last_activity_at: string;
  storage_bucket: string | null;
  storage_key: string | null;
  estimated_bytes: number | string | null;
}

interface PurgedGuestProjectRow {
  project_id: string;
  workspace_id: string;
  deleted_asset_count: number;
}

export interface GuestRetentionPurgeResult {
  cutoffIso: string;
  purgedProjectCount: number;
  deletedAssetCount: number;
  deletedObjectCount: number;
  reclaimedBytes: number;
  failedObjectCount: number;
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

export function mapExpiredGuestProjectObject(
  row: ExpiredGuestProjectObjectRow
): ExpiredGuestProjectObject {
  return {
    projectId: row.project_id,
    workspaceId: row.workspace_id,
    lastActivityAt: new Date(row.last_activity_at).toISOString(),
    storageBucket: row.storage_bucket,
    storageKey: row.storage_key,
    estimatedBytes: Number(row.estimated_bytes ?? 0) || 0,
  };
}

export async function listExpiredGuestProjectObjects(
  cutoff: Date
): Promise<ExpiredGuestProjectObject[]> {
  const db = getServiceSupabase();
  const rows = await runQuery(
    "guestRetention.listExpiredGuestProjectObjects",
    db.rpc("list_expired_anonymous_projects", { p_before: cutoff.toISOString() })
  );
  return ((rows ?? []) as ExpiredGuestProjectObjectRow[]).map(
    mapExpiredGuestProjectObject
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
  const objects = await listExpiredGuestProjectObjects(cutoff);

  let deletedObjectCount = 0;
  let failedObjectCount = 0;
  let reclaimedBytes = 0;
  const seenObjects = new Set<string>();

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

  const purgedRows = await purgeExpiredGuestProjects(cutoff);
  const result: GuestRetentionPurgeResult = {
    cutoffIso: cutoff.toISOString(),
    purgedProjectCount: purgedRows.length,
    deletedAssetCount: purgedRows.reduce(
      (total, row) => total + Number(row.deleted_asset_count ?? 0),
      0
    ),
    deletedObjectCount,
    reclaimedBytes,
    failedObjectCount,
  };

  logger.info("guest_retention.purged_projects", {
    cutoffIso: result.cutoffIso,
    purgedProjectCount: result.purgedProjectCount,
    deletedAssetCount: result.deletedAssetCount,
    deletedObjectCount: result.deletedObjectCount,
    reclaimedBytes: result.reclaimedBytes,
    failedObjectCount: result.failedObjectCount,
  });
  return result;
}

async function purgeExpiredGuestProjects(
  cutoff: Date
): Promise<PurgedGuestProjectRow[]> {
  const db = getServiceSupabase();
  const { data, error } = await db.rpc("purge_expired_anonymous_projects", {
    p_before: cutoff.toISOString(),
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
