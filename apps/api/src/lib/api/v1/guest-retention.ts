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

export interface PurgeableAnonymousUser {
  userId: string;
  authId: string;
  email: string | null;
  isAnonymous: boolean;
}

interface PurgeableAnonymousUserRow {
  user_id: string;
  auth_id: string | null;
  email: string | null;
  is_anonymous: boolean | null;
}

export interface AnonymousUserPurgeStats {
  candidateUserCount: number;
  deletedUserCount: number;
  failedUserDeleteCount: number;
  deletedUserRowCount: number;
}

export interface GuestRetentionPurgeResult extends AnonymousUserPurgeStats {
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

export function mapPurgeableAnonymousUser(
  row: PurgeableAnonymousUserRow
): PurgeableAnonymousUser {
  return {
    userId: row.user_id,
    authId: row.auth_id ?? "",
    email: row.email,
    isAnonymous: row.is_anonymous === true,
  };
}

/**
 * Defense-in-depth over the SQL claim: only auth users that are verifiably
 * anonymous (is_anonymous, no email) may be deleted. Claimed accounts that slip
 * through the RPC for any reason are dropped here.
 */
export function filterDeletableAnonymousUsers(
  users: PurgeableAnonymousUser[]
): PurgeableAnonymousUser[] {
  return users.filter(
    (user) =>
      user.isAnonymous === true &&
      (user.email ?? "").trim() === "" &&
      user.authId !== "" &&
      user.userId !== ""
  );
}

export async function deleteOrphanedAnonymousUsers(
  candidates: PurgeableAnonymousUser[],
  deps: {
    deleteAuthUser: (authId: string) => Promise<void>;
    purgeUserRows: (userIds: string[]) => Promise<string[]>;
    logger?: Logger;
  }
): Promise<AnonymousUserPurgeStats> {
  const logger = deps.logger ?? rootLogger;
  const deletable = filterDeletableAnonymousUsers(candidates);
  for (const skipped of candidates.filter((user) => !deletable.includes(user))) {
    logger.warn("guest_retention.user_delete_skipped_not_anonymous", {
      userId: skipped.userId,
      isAnonymous: skipped.isAnonymous,
      hasEmail: (skipped.email ?? "").trim() !== "",
    });
  }

  let deletedUserCount = 0;
  let failedUserDeleteCount = 0;
  const deletedUserIds: string[] = [];

  for (const user of deletable) {
    try {
      await deps.deleteAuthUser(user.authId);
      deletedUserCount += 1;
      deletedUserIds.push(user.userId);
    } catch (error) {
      failedUserDeleteCount += 1;
      logger.warn("guest_retention.auth_user_delete_failed", {
        userId: user.userId,
        error: {
          message:
            error instanceof Error ? error.message : "Auth user delete failed.",
        },
      });
    }
  }

  let deletedRowUserIds: string[] = [];
  if (deletedUserIds.length > 0) {
    try {
      deletedRowUserIds = await deps.purgeUserRows(deletedUserIds);
    } catch (error) {
      // The auth users are already gone; a stranded public.users row is inert
      // (no MAU) and this run's metrics are still worth reporting.
      logger.warn("guest_retention.user_row_purge_failed", {
        userIds: deletedUserIds,
        error: {
          message:
            error instanceof Error ? error.message : "User row purge failed.",
        },
      });
    }
  }
  return {
    candidateUserCount: deletable.length,
    deletedUserCount,
    failedUserDeleteCount,
    deletedUserRowCount: deletedRowUserIds.length,
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

  const purgedWorkspaceIds = [...new Set(purgedRows.map((row) => row.workspace_id))];
  const userCandidates =
    purgedWorkspaceIds.length > 0
      ? await claimPurgeableAnonymousUsers(purgedWorkspaceIds)
      : [];
  const userPurge = await deleteOrphanedAnonymousUsers(userCandidates, {
    deleteAuthUser: deleteAnonymousAuthUser,
    purgeUserRows: purgeAnonymousUserRows,
    logger,
  });

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
    ...userPurge,
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
  logger.info("guest_retention.purged_anonymous_users", {
    candidateUserCount: result.candidateUserCount,
    deletedUserCount: result.deletedUserCount,
    failedUserDeleteCount: result.failedUserDeleteCount,
    deletedUserRowCount: result.deletedUserRowCount,
  });
  return result;
}

export async function claimPurgeableAnonymousUsers(
  workspaceIds: string[]
): Promise<PurgeableAnonymousUser[]> {
  const db = getServiceSupabase();
  const rows = await runQuery(
    "guestRetention.claimPurgeableAnonymousUsers",
    db.rpc("claim_purgeable_anonymous_users", {
      p_workspace_ids: workspaceIds,
    })
  );
  return ((rows ?? []) as PurgeableAnonymousUserRow[]).map(
    mapPurgeableAnonymousUser
  );
}

async function deleteAnonymousAuthUser(authId: string): Promise<void> {
  const { error } = await getServiceSupabase().auth.admin.deleteUser(authId);
  if (error) throw error;
}

async function purgeAnonymousUserRows(userIds: string[]): Promise<string[]> {
  const db = getServiceSupabase();
  const { data, error } = await db.rpc("purge_anonymous_user_rows", {
    p_user_ids: userIds,
  });
  if (error) throw databaseError("guestRetention.purgeAnonymousUserRows", error);
  return ((data ?? []) as { user_id: string }[]).map((row) => row.user_id);
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
