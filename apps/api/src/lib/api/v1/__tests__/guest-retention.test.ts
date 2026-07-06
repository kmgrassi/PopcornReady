import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  GUEST_RETENTION_DAYS,
  guestRetentionCutoff,
  isGuestRetentionJobAuthorized,
  isGuestRetentionRunOnStartEnabled,
  isGuestRetentionSchedulerEnabled,
  mapExpiredGuestProjectObject,
} from "../guest-retention";

test("guestRetentionCutoff uses the 30-day inactivity policy", () => {
  const now = new Date("2026-07-06T12:00:00.000Z");
  assert.equal(GUEST_RETENTION_DAYS, 30);
  assert.equal(
    guestRetentionCutoff(now).toISOString(),
    "2026-06-06T12:00:00.000Z"
  );
});

test("mapExpiredGuestProjectObject normalizes nullable storage rows", () => {
  const mapped = mapExpiredGuestProjectObject({
    project_id: "project_1",
    workspace_id: "workspace_1",
    last_activity_at: "2026-06-01T00:00:00Z",
    storage_bucket: null,
    storage_key: null,
    estimated_bytes: "42",
  });

  assert.deepEqual(mapped, {
    projectId: "project_1",
    workspaceId: "workspace_1",
    lastActivityAt: "2026-06-01T00:00:00.000Z",
    storageBucket: null,
    storageKey: null,
    estimatedBytes: 42,
  });
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
  assert.match(migration, /purge_expired_anonymous_projects requires service_role/);
  assert.doesNotMatch(migration, /auth\.uid\(\)/);
});
