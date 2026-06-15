// Throwaway workspace + project lifecycle for end-to-end tool tests. Each case
// runs against its own sandbox so real INSERTs are exercised and then fully
// removed. Teardown deletes the workspace; FK cascades remove its projects,
// assets, actions, edges, and selections in one statement.

import { randomUUID } from "node:crypto";

import { deploymentMetadata } from "@/lib/api/v1/store-internal";
import { createProject, ensureLocalWorkspace } from "@/lib/api/v1/store";
import { getServiceSupabase } from "@/lib/supabase/clients";
import { assertDeletableSandboxName, TEST_WORKSPACE_PREFIX } from "./sandbox-guard";
import type { Sandbox } from "./types";

export { TEST_WORKSPACE_PREFIX, assertDeletableSandboxName } from "./sandbox-guard";

// Create a uniquely-named sandbox workspace (unowned, matched by name) plus an
// empty project for tools to write into.
export async function createSandbox(): Promise<Sandbox> {
  const workspaceName = `${TEST_WORKSPACE_PREFIX}${randomUUID()}`;
  const workspace = await ensureLocalWorkspace(workspaceName);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const db = getServiceSupabase();
  const { error: workspaceError } = await db
    .from("workspaces")
    .update({ purpose: "internal_test", expires_at: expiresAt })
    .eq("id", workspace.id);
  if (workspaceError) {
    throw new Error(`createSandbox failed to mark workspace: ${workspaceError.message}`);
  }

  const { project } = await createProject({
    workspaceId: workspace.id,
    name: "tool-test sandbox project",
  });
  const { data: sandboxRow, error: sandboxError } = await db
    .from("test_sandboxes")
    .insert({
      workspace_id: workspace.id,
      project_id: project.id,
      purpose: "tool-test",
      ...deploymentMetadata(),
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (sandboxError) {
    throw new Error(`createSandbox failed to record sandbox: ${sandboxError.message}`);
  }

  return {
    workspaceId: workspace.id,
    projectId: project.id,
    workspaceName,
    sandboxId: sandboxRow?.id as string | undefined,
  };
}

// Delete the sandbox workspace (cascades to everything under it). Guarded twice:
// the name must carry the test prefix, and the DELETE itself is constrained to
// rows whose name matches the prefix.
export async function teardownSandbox(sandbox: Sandbox): Promise<void> {
  assertDeletableSandboxName(sandbox.workspaceName);
  const db = getServiceSupabase();
  if (sandbox.sandboxId) {
    const { data, error } = await db.rpc("delete_test_sandbox", {
      p_sandbox_id: sandbox.sandboxId,
    });
    if (error) {
      throw new Error(`teardownSandbox failed: ${error.message}`);
    }
    if (data === true) return;
  }

  const { error } = await db
    .from("workspaces")
    .delete()
    .eq("id", sandbox.workspaceId)
    .eq("purpose", "internal_test")
    .like("name", `${TEST_WORKSPACE_PREFIX}%`);
  if (error) {
    throw new Error(`teardownSandbox failed: ${error.message}`);
  }
}

// Remove any sandbox workspaces left behind by crashed runs. Returns the count
// deleted. Run at the start of a suite.
export async function sweepOrphanSandboxes(): Promise<number> {
  const db = getServiceSupabase();
  const { data: sandboxes, error: sandboxError } = await db
    .from("test_sandboxes")
    .select("id")
    .eq("purpose", "tool-test");
  if (sandboxError) {
    throw new Error(`sweepOrphanSandboxes failed: ${sandboxError.message}`);
  }

  let deleted = 0;
  for (const row of sandboxes ?? []) {
    const { data, error } = await db.rpc("delete_test_sandbox", {
      p_sandbox_id: row.id,
    });
    if (error) {
      throw new Error(`sweepOrphanSandboxes failed: ${error.message}`);
    }
    if (data === true) deleted += 1;
  }

  const { data: legacy, error } = await db
    .from("workspaces")
    .delete()
    .eq("purpose", "internal_test")
    .like("name", `${TEST_WORKSPACE_PREFIX}%`)
    .select("id");
  if (error) {
    throw new Error(`sweepOrphanSandboxes failed: ${error.message}`);
  }
  return deleted + (legacy?.length ?? 0);
}
