import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  GUEST_RETENTION_DAYS,
  deleteOrphanedAnonymousUsers,
  filterDeletableAnonymousUsers,
  guestRetentionCutoff,
  isGuestRetentionJobAuthorized,
  isGuestRetentionRunOnStartEnabled,
  isGuestRetentionSchedulerEnabled,
  mapClaimedGuestProjectObject,
  mapPurgeableAnonymousUser,
  projectIdsReadyForHardPurge,
} from "../guest-retention";

import type { Logger } from "../../../v1/logger";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

test("guestRetentionCutoff uses the 30-day inactivity policy", () => {
  const now = new Date("2026-07-06T12:00:00.000Z");
  assert.equal(GUEST_RETENTION_DAYS, 30);
  assert.equal(
    guestRetentionCutoff(now).toISOString(),
    "2026-06-06T12:00:00.000Z"
  );
});

test("mapClaimedGuestProjectObject normalizes nullable storage rows", () => {
  const mapped = mapClaimedGuestProjectObject({
    project_id: "project_1",
    workspace_id: "workspace_1",
    last_activity_at: "2026-06-01T00:00:00Z",
    storage_bucket: null,
    storage_key: null,
    estimated_bytes: "42",
    deleted_asset_count: "3",
  });

  assert.deepEqual(mapped, {
    projectId: "project_1",
    workspaceId: "workspace_1",
    lastActivityAt: "2026-06-01T00:00:00.000Z",
    storageBucket: null,
    storageKey: null,
    estimatedBytes: 42,
    deletedAssetCount: 3,
  });
});

test("projectIdsReadyForHardPurge keeps failed projects for retry", () => {
  assert.deepEqual(
    projectIdsReadyForHardPurge(
      ["project_ok", "project_failed", "project_ok"],
      ["project_failed"]
    ),
    ["project_ok"]
  );
});

test("guest retention scheduler is opt-in", () => {
  assert.equal(isGuestRetentionSchedulerEnabled({}), false);
  assert.equal(
    isGuestRetentionSchedulerEnabled({ GUEST_RETENTION_PURGE_ENABLED: "true" }),
    true
  );
  assert.equal(
    isGuestRetentionRunOnStartEnabled({ GUEST_RETENTION_PURGE_RUN_ON_START: "true" }),
    true
  );
});

test("guest retention job requires the configured bearer token", () => {
  const env = { GUEST_RETENTION_JOB_TOKEN: "secret" };
  assert.equal(isGuestRetentionJobAuthorized(undefined, env), false);
  assert.equal(isGuestRetentionJobAuthorized("wrong", env), false);
  assert.equal(isGuestRetentionJobAuthorized("secret", env), true);
  assert.equal(isGuestRetentionJobAuthorized("Bearer secret", env), true);
  assert.equal(isGuestRetentionJobAuthorized("secret", {}), false);
});

test("guest retention migration only purges expired anonymous-owned projects", () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const migration = readFileSync(
    path.resolve(
      __dirname,
      "../../../../../../../supabase/migrations/20260706120000_guest_retention_purge.sql"
    ),
    "utf8"
  );

  assert.match(migration, /au\.is_anonymous is true/);
  assert.match(migration, /p\.last_activity_at < p_before/);
  assert.match(migration, /claim_expired_anonymous_projects requires service_role/);
  assert.match(migration, /public\.orchestrator_runs/);
  assert.match(migration, /guest_retention_purge_claimed_at/);
  assert.doesNotMatch(migration, /public\.generation_runs/);
  assert.doesNotMatch(migration, /auth\.uid\(\)/);
});

test("mapPurgeableAnonymousUser normalizes nullable rows", () => {
  assert.deepEqual(
    mapPurgeableAnonymousUser({
      user_id: "user_1",
      auth_id: null,
      email: null,
      is_anonymous: null,
    }),
    { userId: "user_1", authId: "", email: null, isAnonymous: false }
  );
});

test("claimed (non-anonymous) users are never deletable", () => {
  const anonymous = {
    userId: "user_anon",
    authId: "auth_anon",
    email: null,
    isAnonymous: true,
  };
  const claimed = {
    userId: "user_claimed",
    authId: "auth_claimed",
    email: "creator@example.com",
    isAnonymous: false,
  };
  const claimedWithoutEmail = {
    userId: "user_claimed_no_email",
    authId: "auth_claimed_no_email",
    email: null,
    isAnonymous: false,
  };
  const anonymousWithEmail = {
    userId: "user_anon_email",
    authId: "auth_anon_email",
    email: "linked@example.com",
    isAnonymous: true,
  };
  const missingAuthId = {
    userId: "user_no_auth",
    authId: "",
    email: null,
    isAnonymous: true,
  };

  assert.deepEqual(
    filterDeletableAnonymousUsers([
      anonymous,
      claimed,
      claimedWithoutEmail,
      anonymousWithEmail,
      missingAuthId,
    ]),
    [anonymous]
  );
});

test("deleteOrphanedAnonymousUsers deletes only anonymous users and reports metrics", async () => {
  const deletedAuthIds: string[] = [];
  const purgedRowUserIds: string[][] = [];

  const stats = await deleteOrphanedAnonymousUsers(
    [
      { userId: "user_1", authId: "auth_1", email: null, isAnonymous: true },
      { userId: "user_2", authId: "auth_2", email: null, isAnonymous: true },
      {
        userId: "user_claimed",
        authId: "auth_claimed",
        email: "creator@example.com",
        isAnonymous: false,
      },
    ],
    {
      deleteAuthUser: async (authId) => {
        deletedAuthIds.push(authId);
      },
      purgeUserRows: async (userIds) => {
        purgedRowUserIds.push(userIds);
        return userIds;
      },
      logger: silentLogger,
    }
  );

  assert.deepEqual(deletedAuthIds, ["auth_1", "auth_2"]);
  assert.deepEqual(purgedRowUserIds, [["user_1", "user_2"]]);
  assert.deepEqual(stats, {
    candidateUserCount: 2,
    deletedUserCount: 2,
    failedUserDeleteCount: 0,
    deletedUserRowCount: 2,
  });
});

test("deleteOrphanedAnonymousUsers keeps rows for failed auth deletes", async () => {
  const purgedRowUserIds: string[][] = [];

  const stats = await deleteOrphanedAnonymousUsers(
    [
      { userId: "user_ok", authId: "auth_ok", email: null, isAnonymous: true },
      { userId: "user_fail", authId: "auth_fail", email: null, isAnonymous: true },
    ],
    {
      deleteAuthUser: async (authId) => {
        if (authId === "auth_fail") throw new Error("gotrue unavailable");
      },
      purgeUserRows: async (userIds) => {
        purgedRowUserIds.push(userIds);
        return userIds;
      },
      logger: silentLogger,
    }
  );

  assert.deepEqual(purgedRowUserIds, [["user_ok"]]);
  assert.deepEqual(stats, {
    candidateUserCount: 2,
    deletedUserCount: 1,
    failedUserDeleteCount: 1,
    deletedUserRowCount: 1,
  });
});

test("deleteOrphanedAnonymousUsers skips row purge when nothing was deleted", async () => {
  let purgeUserRowsCalls = 0;

  const stats = await deleteOrphanedAnonymousUsers([], {
    deleteAuthUser: async () => {
      throw new Error("must not be called");
    },
    purgeUserRows: async (userIds) => {
      purgeUserRowsCalls += 1;
      return userIds;
    },
    logger: silentLogger,
  });

  assert.equal(purgeUserRowsCalls, 0);
  assert.deepEqual(stats, {
    candidateUserCount: 0,
    deletedUserCount: 0,
    failedUserDeleteCount: 0,
    deletedUserRowCount: 0,
  });
});

test("deleteOrphanedAnonymousUsers survives a failed user-row purge", async () => {
  const stats = await deleteOrphanedAnonymousUsers(
    [{ userId: "user_1", authId: "auth_1", email: null, isAnonymous: true }],
    {
      deleteAuthUser: async () => {},
      purgeUserRows: async () => {
        throw new Error("rpc down");
      },
      logger: silentLogger,
    }
  );

  assert.deepEqual(stats, {
    candidateUserCount: 1,
    deletedUserCount: 1,
    failedUserDeleteCount: 0,
    deletedUserRowCount: 0,
  });
});

test("anonymous-user purge migration never deletes claimed users or surviving projects' owners", () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const migration = readFileSync(
    path.resolve(
      __dirname,
      "../../../../../../../supabase/migrations/20260706150000_guest_retention_anonymous_user_purge.sql"
    ),
    "utf8"
  );

  // Claimed users never match: anonymous flag + no-email guard on the claim.
  assert.match(migration, /au\.is_anonymous is true/);
  assert.match(migration, /coalesce\(au\.email::text, ''\) = ''/);
  // An anon user with any surviving project is never a candidate, and the
  // row purge re-checks the same ownership condition.
  const remainingProjectGuards = migration.match(
    /not exists \(\s*select 1\s*from public\.projects p\s*join public\.workspaces ow on ow\.id = p\.workspace_id\s*where ow\.owner_id = u\.id\s*\)/g
  );
  assert.equal(remainingProjectGuards?.length, 2);
  // The public.users row is only removed once the auth identity is gone.
  assert.match(
    migration,
    /not exists \(select 1 from auth\.users au where au\.id = u\.auth_id\)/
  );
  // Pre-created invited users (email, auth pending) are protected.
  assert.match(migration, /coalesce\(u\.email, ''\) = ''/);
  // Only project-free workspaces are removed.
  assert.match(
    migration,
    /not exists \(select 1 from public\.projects p where p\.workspace_id = w\.id\)/
  );
  assert.match(migration, /claim_purgeable_anonymous_users requires service_role/);
  assert.match(migration, /purge_anonymous_user_rows requires service_role/);
  assert.match(
    migration,
    /grant execute on function public\.claim_purgeable_anonymous_users\(uuid\[\]\) to service_role/
  );
  assert.match(
    migration,
    /grant execute on function public\.purge_anonymous_user_rows\(uuid\[\]\) to service_role/
  );
  assert.doesNotMatch(migration, /auth\.uid\(\)/);
});
