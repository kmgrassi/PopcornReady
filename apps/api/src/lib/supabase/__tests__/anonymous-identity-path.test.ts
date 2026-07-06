import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const initSchema = readFileSync(
  resolve(testDir, "../../../../../../supabase/migrations/20260603000000_init_schema.sql"),
  "utf8"
);
const authMiddleware = readFileSync(
  resolve(testDir, "../../../middleware/auth.ts"),
  "utf8"
);
const accountRoutes = readFileSync(
  resolve(testDir, "../../../routes/v1/account.ts"),
  "utf8"
);
const deviceRecoveryMigration = readFileSync(
  resolve(
    testDir,
    "../../../../../../supabase/migrations/20260706133000_anonymous_device_recovery.sql"
  ),
  "utf8"
);

test("anonymous auth users mirror into public.users without email collisions", () => {
  assert.match(initSchema, /create table public\.users \([\s\S]*?email\s+text,/);
  assert.match(initSchema, /auth_id\s+uuid unique references auth\.users/);
  assert.match(
    initSchema,
    /create unique index users_unique_unlinked_email[\s\S]*?where auth_id is null and email is not null and btrim\(email\) <> '';/,
    "email uniqueness must ignore null/blank emails so concurrent anonymous users do not collide"
  );
  assert.match(
    initSchema,
    /if nullif\(v_email, ''\) is not null then[\s\S]*?select id into v_existing[\s\S]*?end if;/,
    "handle_new_user should only attempt email adoption when an email exists"
  );
  assert.match(
    initSchema,
    /insert into public\.users \(auth_id, email,[\s\S]*?values \(\s*new\.id,\s*v_email,/,
    "email-less auth users should still insert a public.users row linked by auth_id"
  );
});

test("request auth resolves anonymous sessions through current_app_user_id", () => {
  assert.match(
    initSchema,
    /create or replace function public\.current_app_user_id\(\)[\s\S]*?select id from public\.users where auth_id = auth\.uid\(\) limit 1/,
    "current_app_user_id must map auth.uid() to the domain user id"
  );
  assert.match(
    initSchema,
    /grant execute on function public\.current_app_user_id\(\) to authenticated, service_role;/,
    "anonymous Supabase sessions use the authenticated role once signed in"
  );
  assert.match(
    authMiddleware,
    /publicUserId = await resolveAppUserId\(supabase\);/,
    "middleware should resolve the domain id through the user-scoped Supabase client"
  );
  assert.match(
    authMiddleware,
    /req\.publicUserId = publicUserId;/,
    "handlers should receive public.users.id, not auth.users.id"
  );
  assert.doesNotMatch(
    authMiddleware,
    /req\.publicUserId = data\.user\.id/,
    "auth.users.id must not be exposed as the request public user id"
  );
});

test("anonymous device recovery stores only hashed tokens and moves domain workspace", () => {
  assert.match(
    deviceRecoveryMigration,
    /create table if not exists public\.anonymous_device_recovery_tokens/
  );
  assert.match(deviceRecoveryMigration, /token_hash\s+text not null unique/);
  assert.doesNotMatch(deviceRecoveryMigration, /token\s+text not null/);
  assert.match(
    deviceRecoveryMigration,
    /join auth\.users au on au\.id = u\.auth_id[\s\S]*?au\.is_anonymous is true/,
    "recovery should only accept tokens attached to anonymous auth users"
  );
  assert.match(
    deviceRecoveryMigration,
    /recover_anonymous_workspace requires service_role/,
    "workspace recovery must be service-role only"
  );
  assert.match(
    deviceRecoveryMigration,
    /update public\.workspaces[\s\S]*?set owner_id = p_current_user_id/,
    "recovery should transfer the workspace to the current domain user"
  );
  assert.match(
    deviceRecoveryMigration,
    /delete from public\.workspace_members wm[\s\S]*?wm\.workspace_id = v_source_workspace_id/,
    "workspace member cleanup must qualify workspace_id inside the RETURNS TABLE function"
  );
});

test("anonymous device recovery API is anonymous-only and hashes the browser secret", () => {
  assert.match(
    accountRoutes,
    /ctx\.isAnonymous/,
    "routes must reject non-anonymous sessions"
  );
  assert.match(
    accountRoutes,
    /createHmac\("sha256", pepper\)|createHash\("sha256"\)/,
    "API should hash the browser-held recovery token"
  );
  assert.match(
    accountRoutes,
    /\.from\("anonymous_device_recovery_tokens"\)/,
    "registration should write the dedicated recovery-token table"
  );
  assert.match(
    accountRoutes,
    /ignoreDuplicates: true/,
    "registration must not rebind an existing recovery token to a new anonymous user"
  );
  assert.match(
    accountRoutes,
    /\.rpc\("recover_anonymous_workspace"/,
    "recovery should use the service-role SQL function"
  );
});
