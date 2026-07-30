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
  label: string,
  cleanupIds: { authUserIds: string[]; domainUserIds: string[] }
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
  cleanupIds.authUserIds.push(authUserId);

  const { data: domainUser, error: domainError } = await service
    .from("users")
    .select("id")
    .eq("auth_id", authUserId)
    .single();
  assertNoError(domainError, `resolve ${label} domain user`);
  assert.ok(domainUser?.id, `${label} domain user must exist`);
  cleanupIds.domainUserIds.push(domainUser.id);

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
  "migrated graph snapshot enforces the story-spine read and write RLS matrix",
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
    const cleanupIds = { authUserIds: [] as string[], domainUserIds: [] as string[] };

    try {
      const owner = await signedInClient(service, suffix, "owner", cleanupIds);
      const admin = await signedInClient(service, suffix, "admin", cleanupIds);
      const member = await signedInClient(service, suffix, "member", cleanupIds);
      const outsider = await signedInClient(service, suffix, "outsider", cleanupIds);

      const { error: workspaceError } = await service.from("workspaces").insert({
        id: workspaceId,
        owner_id: owner.domainUserId,
        name: `__graph_contract__${suffix}`,
      });
      assertNoError(workspaceError, "seed owner workspace");

      const { error: membershipError } = await service.from("workspace_members").insert([
        {
          workspace_id: workspaceId,
          user_id: admin.domainUserId,
          role: "admin",
          invited_by: owner.domainUserId,
        },
        {
          workspace_id: workspaceId,
          user_id: member.domainUserId,
          role: "member",
          invited_by: owner.domainUserId,
        },
      ]);
      assertNoError(membershipError, "seed admin and member workspace memberships");

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
        ["story_blueprint_acts", actId],
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
        for (const [role, db] of [
          ["owner", owner.db],
          ["admin", admin.db],
          ["member", member.db],
        ] as const) {
          assert.deepEqual(
            await visibleIds(db, table, projectId, `authenticated ${role} RLS`),
            [expectedId],
            `${role} must see private ${table}`
          );
        }
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

      for (const [role, db, panelIndex] of [
        ["admin", admin.db, 1],
        ["member", member.db, 2],
      ] as const) {
        const writablePanelId = randomUUID();
        const { data: insertedPanel, error: insertPanelError } = await db
          .from("story_panels")
          .insert({
            id: writablePanelId,
            project_id: projectId,
            beat_id: beatId,
            panel_index: panelIndex,
            status: "ready",
            is_selected: false,
          })
          .select("id")
          .single();
        assertNoError(insertPanelError, `${role} insert public.story_panels`);
        assert.equal(insertedPanel?.id, writablePanelId);

        const { data: updatedPanel, error: updatePanelError } = await db
          .from("story_panels")
          .update({ status: "approved" })
          .eq("id", writablePanelId)
          .select("id, status")
          .single();
        assertNoError(updatePanelError, `${role} update public.story_panels`);
        assert.deepEqual(updatedPanel, { id: writablePanelId, status: "approved" });

        const { data: deletedPanel, error: deletePanelError } = await db
          .from("story_panels")
          .delete()
          .eq("id", writablePanelId)
          .select("id")
          .single();
        assertNoError(deletePanelError, `${role} delete public.story_panels`);
        assert.equal(deletedPanel?.id, writablePanelId);
      }

      const { error: publishError } = await service
        .from("projects")
        .update({ visibility: "public" })
        .eq("id", projectId);
      assertNoError(publishError, "publish project for positive public-read contract");

      for (const [table, expectedId] of expected) {
        assert.deepEqual(
          await visibleIds(outsider.db, table, projectId, "public outsider RLS"),
          [expectedId],
          `outsider must see public ${table}`
        );
        assert.deepEqual(
          await visibleIds(anon, table, projectId, "public anonymous RLS"),
          [expectedId],
          `anonymous caller must see public ${table}`
        );
      }

      for (const [role, db, panelIndex] of [
        ["outsider", outsider.db, 3],
        ["anonymous", anon, 4],
      ] as const) {
        const { error } = await db.from("story_panels").insert({
          id: randomUUID(),
          project_id: projectId,
          beat_id: beatId,
          panel_index: panelIndex,
          status: "ready",
          is_selected: false,
        });
        assert.ok(error, `${role} must not insert a public story panel`);

        const { data: attemptedUpdate, error: attemptedUpdateError } = await db
          .from("story_panels")
          .update({ status: "failed" })
          .eq("id", panelId)
          .select("id");
        assertNoError(attemptedUpdateError, `${role} denied story-panel update`);
        assert.deepEqual(
          attemptedUpdate,
          [],
          `${role} must not update a public story panel`
        );

        const { data: attemptedDelete, error: attemptedDeleteError } = await db
          .from("story_panels")
          .delete()
          .eq("id", panelId)
          .select("id");
        assertNoError(attemptedDeleteError, `${role} denied story-panel delete`);
        assert.deepEqual(
          attemptedDelete,
          [],
          `${role} must not delete a public story panel`
        );
      }

      const { data: unchangedPanel, error: unchangedPanelError } = await service
        .from("story_panels")
        .select("id, status")
        .eq("id", panelId)
        .single();
      assertNoError(unchangedPanelError, "verify denied story-panel writes");
      assert.deepEqual(unchangedPanel, { id: panelId, status: "ready" });

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
      for (const authUserId of cleanupIds.authUserIds) {
        const { error } = await service.from("users").delete().eq("auth_id", authUserId);
        if (error) {
          cleanupFailures.push(
            `domain user for auth ${authUserId} (${error.code ?? "unknown"}): ${error.message}`
          );
        }
      }
      for (const domainUserId of cleanupIds.domainUserIds) {
        const { error } = await service.from("users").delete().eq("id", domainUserId);
        if (error) {
          cleanupFailures.push(
            `domain user ${domainUserId} (${error.code ?? "unknown"}): ${error.message}`
          );
        }
      }
      for (const authUserId of cleanupIds.authUserIds) {
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
