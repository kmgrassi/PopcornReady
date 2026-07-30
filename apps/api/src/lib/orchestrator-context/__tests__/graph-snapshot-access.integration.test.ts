import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadProjectGraphSnapshot } from "../graph-snapshot";

const localUrl = process.env.SUPABASE_URL ?? "";
const runLocalIntegration =
  process.env.RUN_LOCAL_DB_INTEGRATION === "1" &&
  /127\.0\.0\.1|localhost/.test(localUrl) &&
  Boolean(process.env.SUPABASE_ANON_KEY) &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

const integrationTest = runLocalIntegration ? test : test.skip;

function client(key: string, accessToken?: string): SupabaseClient {
  return createClient(localUrl, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    ...(accessToken
      ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
      : {}),
  });
}

function assertNoError(
  error: { code?: string; message: string } | null,
  operation: string
): void {
  assert.equal(
    error,
    null,
    `${operation} failed (${error?.code ?? "unknown"}): ${error?.message ?? "unknown error"}`
  );
}

async function signedInClient(
  service: SupabaseClient,
  suffix: string,
  label: string
): Promise<{ authUserId: string; domainUserId: string; db: SupabaseClient }> {
  const email = `graph-contract-${label}-${suffix}@example.test`;
  const password = `Db!${suffix}x`;
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assertNoError(createError, `create ${label} auth user`);
  const authUserId = created.user?.id;
  assert.ok(authUserId, `${label} auth user must have an id`);

  const { data: domainUser, error: domainError } = await service
    .from("users")
    .select("id")
    .eq("auth_id", authUserId)
    .single();
  assertNoError(domainError, `resolve ${label} domain user`);
  assert.ok(domainUser?.id, `${label} domain user must exist`);

  const authBase = client(process.env.SUPABASE_ANON_KEY!);
  const { data: signedIn, error: signInError } = await authBase.auth.signInWithPassword({
    email,
    password,
  });
  assertNoError(signInError, `sign in ${label}`);
  assert.ok(signedIn.session?.access_token, `${label} must receive an access token`);

  return {
    authUserId,
    domainUserId: domainUser.id,
    db: client(process.env.SUPABASE_ANON_KEY!, signedIn.session.access_token),
  };
}

async function visibleIds(
  db: SupabaseClient,
  table: string,
  projectId: string,
  accessLabel: string
): Promise<string[]> {
  const { data, error } = await db
    .from(table)
    .select("id")
    .eq("project_id", projectId);
  assertNoError(error, `${accessLabel} select public.${table}`);
  return (data ?? []).map((row) => row.id as string);
}

integrationTest(
  "migrated graph snapshot reads the story spine and RLS isolates private rows",
  async () => {
    const service = client(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const anon = client(process.env.SUPABASE_ANON_KEY!);
    const suffix = randomUUID();
    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const blueprintId = randomUUID();
    const actId = randomUUID();
    const sceneId = randomUUID();
    const beatId = randomUUID();
    const panelId = randomUUID();
    let ownerAuthUserId: string | undefined;
    let ownerDomainUserId: string | undefined;
    let outsiderAuthUserId: string | undefined;
    let outsiderDomainUserId: string | undefined;

    try {
      const owner = await signedInClient(service, suffix, "owner");
      ownerAuthUserId = owner.authUserId;
      ownerDomainUserId = owner.domainUserId;
      const outsider = await signedInClient(service, suffix, "outsider");
      outsiderAuthUserId = outsider.authUserId;
      outsiderDomainUserId = outsider.domainUserId;

      const { error: workspaceError } = await service.from("workspaces").insert({
        id: workspaceId,
        owner_id: owner.domainUserId,
        name: `__graph_contract__${suffix}`,
      });
      assertNoError(workspaceError, "seed owner workspace");

      const { error: projectError } = await service.from("projects").insert({
        id: projectId,
        workspace_id: workspaceId,
        name: `Graph contract ${suffix}`,
        visibility: "private",
      });
      assertNoError(projectError, "seed private project");

      const { error: blueprintError } = await service.from("story_blueprints").insert({
        id: blueprintId,
        schema_version: "storyBlueprint.v1",
        workspace_id: workspaceId,
        project_id: projectId,
        status: "approved",
        snapshot: { schema: "storyBlueprint.v1" },
        provenance: {
          schema: "story_blueprint_provenance.v1",
          planAssetId: null,
        },
      });
      assertNoError(blueprintError, "seed public.story_blueprints");

      const { error: currentError } = await service
        .from("projects")
        .update({ current_story_blueprint_id: blueprintId })
        .eq("id", projectId);
      assertNoError(currentError, "select current story blueprint");

      const { error: actError } = await service.from("story_blueprint_acts").insert({
        id: actId,
        story_blueprint_id: blueprintId,
        workspace_id: workspaceId,
        project_id: projectId,
        stable_id: "act_contract",
        position: 0,
        title: "Contract act",
        purpose: "Prove the current story hierarchy.",
        summary: "No provider calls.",
        target_duration_sec: 4,
        status: "approved",
      });
      assertNoError(actError, "seed public.story_blueprint_acts");

      const { error: sceneError } = await service.from("story_blueprint_scenes").insert({
        id: sceneId,
        story_blueprint_id: blueprintId,
        story_blueprint_act_id: actId,
        workspace_id: workspaceId,
        project_id: projectId,
        stable_id: "scene_contract",
        position: 0,
        title: "Contract scene",
        summary: "Exercises the migrated relation.",
        target_duration_sec: 4,
        status: "approved",
      });
      assertNoError(sceneError, "seed public.story_blueprint_scenes");

      const { error: beatError } = await service.from("story_beats").insert({
        id: beatId,
        project_id: projectId,
        scene_id: sceneId,
        beat_index: 0,
        intent: "Prove current beat access.",
        duration_sec: 4,
        status: "approved",
      });
      assertNoError(beatError, "seed public.story_beats");

      const { error: panelError } = await service.from("story_panels").insert({
        id: panelId,
        project_id: projectId,
        beat_id: beatId,
        panel_index: 0,
        status: "ready",
        is_selected: true,
      });
      assertNoError(panelError, "seed public.story_panels");

      const expected = new Map([
        ["story_blueprints", blueprintId],
        ["story_blueprint_scenes", sceneId],
        ["story_beats", beatId],
        ["story_panels", panelId],
      ]);

      // Prove the fixtures exist before interpreting an RLS-hidden empty set.
      for (const [table, expectedId] of expected) {
        assert.deepEqual(
          await visibleIds(service, table, projectId, "service-role schema contract"),
          [expectedId],
          `service role must see the concrete ${table} fixture`
        );
      }

      const snapshot = await loadProjectGraphSnapshot({ workspaceId, projectId });
      assert.equal(snapshot.storyBlueprint?.id, blueprintId);
      assert.equal(snapshot.storyboards[0]?.id, blueprintId);
      assert.equal(snapshot.scenes[0]?.id, sceneId);
      assert.equal(snapshot.beats[0]?.id, beatId);
      assert.equal(snapshot.panels[0]?.id, panelId);
      assert.equal(snapshot.droppedForeignRowCount, 0);

      for (const [table, expectedId] of expected) {
        assert.deepEqual(
          await visibleIds(owner.db, table, projectId, "authenticated owner RLS"),
          [expectedId],
          `owner must see private ${table}`
        );
        assert.deepEqual(
          await visibleIds(outsider.db, table, projectId, "authenticated outsider RLS"),
          [],
          `outsider must not see private ${table}`
        );
        assert.deepEqual(
          await visibleIds(anon, table, projectId, "anonymous RLS"),
          [],
          `anonymous caller must not see private ${table}`
        );
      }

      const [{ count: actionCount, error: actionError }, { count: jobCount, error: jobError }] =
        await Promise.all([
          service
            .from("actions")
            .select("id", { count: "exact", head: true })
            .eq("project_id", projectId),
          service
            .from("jobs")
            .select("id", { count: "exact", head: true })
            .eq("project_id", projectId),
        ]);
      assertNoError(actionError, "verify zero tool actions");
      assertNoError(jobError, "verify zero provider jobs");
      assert.equal(actionCount, 0, "context contract must execute zero tool steps");
      assert.equal(jobCount, 0, "context contract must create zero provider jobs");
    } finally {
      const cleanupFailures: string[] = [];
      const { error: cleanupWorkspaceError } = await service
        .from("workspaces")
        .delete()
        .eq("id", workspaceId);
      if (cleanupWorkspaceError) {
        cleanupFailures.push(
          `workspace (${cleanupWorkspaceError.code ?? "unknown"}): ${cleanupWorkspaceError.message}`
        );
      }
      for (const domainUserId of [ownerDomainUserId, outsiderDomainUserId]) {
        if (!domainUserId) continue;
        const { error } = await service.from("users").delete().eq("id", domainUserId);
        if (error) {
          cleanupFailures.push(
            `domain user ${domainUserId} (${error.code ?? "unknown"}): ${error.message}`
          );
        }
      }
      for (const authUserId of [ownerAuthUserId, outsiderAuthUserId]) {
        if (!authUserId) continue;
        const { error } = await service.auth.admin.deleteUser(authUserId);
        if (error) {
          cleanupFailures.push(
            `auth user ${authUserId} (${error.code ?? "unknown"}): ${error.message}`
          );
        }
      }
      assert.deepEqual(cleanupFailures, [], cleanupFailures.join("\n"));
    }
  }
);
