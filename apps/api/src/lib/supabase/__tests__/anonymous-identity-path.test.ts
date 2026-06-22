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
