// Shared throwaway workspace + project lifecycle for service-role test harnesses.
// Every sandbox owns an internal_test workspace and one canonical project, then
// deletes through the database's delete_test_sandbox() RPC so cleanup matches
// production smoke behavior.

import { randomUUID } from "node:crypto";

import { createProject, ensureLocalWorkspace } from "@/lib/api/v1/store";
import { deploymentMetadata } from "@/lib/api/v1/store-internal";
import { getServiceSupabase } from "@/lib/supabase/clients";

export interface TestSandbox {
  sandboxId: string;
  workspaceId: string;
  projectId: string;
  workspaceName: string;
  purpose: string;
}

export interface CreateTestSandboxOptions {
  prefix: string;
  purpose: string;
  projectName?: string;
  featureSet?: string[];
  ttlMs?: number;
}

export interface SweepTestSandboxesOptions {
  prefix: string;
  purpose: string;
}

export function assertDeletableSandboxName(prefix: string, name: string): void {
  if (!prefix || !name || !name.startsWith(prefix)) {
    throw new Error(`Refusing to delete workspace "${name}": not a ${prefix} sandbox.`);
  }
}

export async function createTestSandbox(
  options: CreateTestSandboxOptions
): Promise<TestSandbox> {
  const workspaceName = `${options.prefix}${randomUUID()}`;
  const workspace = await ensureLocalWorkspace(workspaceName);
  const expiresAt = new Date(Date.now() + (options.ttlMs ?? 24 * 60 * 60 * 1000)).toISOString();
  const db = getServiceSupabase();

  const { error: workspaceError } = await db
    .from("workspaces")
    .update({ purpose: "internal_test", expires_at: expiresAt })
    .eq("id", workspace.id);
  if (workspaceError) {
    throw new Error(`createTestSandbox failed to mark workspace: ${workspaceError.message}`);
  }

  const { project } = await createProject({
    workspaceId: workspace.id,
    name: options.projectName ?? "test sandbox project",
  });

  const { data: sandboxRow, error: sandboxError } = await db
    .from("test_sandboxes")
    .insert({
      workspace_id: workspace.id,
      project_id: project.id,
      purpose: options.purpose,
      feature_set: options.featureSet ?? [],
      ...deploymentMetadata(),
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (sandboxError) {
    throw new Error(`createTestSandbox failed to record sandbox: ${sandboxError.message}`);
  }
  if (!sandboxRow?.id) {
    throw new Error("createTestSandbox failed to return sandbox id.");
  }

  return {
    sandboxId: sandboxRow.id as string,
    workspaceId: workspace.id,
    projectId: project.id,
    workspaceName,
    purpose: options.purpose,
  };
}

export async function teardownTestSandbox(sandbox: {
  sandboxId?: string;
  workspaceId: string;
  workspaceName: string;
  prefix: string;
}): Promise<boolean> {
  assertDeletableSandboxName(sandbox.prefix, sandbox.workspaceName);
  const db = getServiceSupabase();

  if (sandbox.sandboxId) {
    const { data, error } = await db.rpc("delete_test_sandbox", {
      p_sandbox_id: sandbox.sandboxId,
    });
    if (error) {
      throw new Error(`teardownTestSandbox failed: ${error.message}`);
    }
    if (data === true) return true;
  }

  const { data, error } = await db
    .from("workspaces")
    .delete()
    .eq("id", sandbox.workspaceId)
    .eq("purpose", "internal_test")
    .like("name", `${sandbox.prefix}%`)
    .select("id");
  if (error) {
    throw new Error(`teardownTestSandbox failed: ${error.message}`);
  }
  return (data?.length ?? 0) > 0;
}

export async function sweepTestSandboxes(
  options: SweepTestSandboxesOptions
): Promise<number> {
  const db = getServiceSupabase();
  const { data: sandboxes, error: sandboxError } = await db
    .from("test_sandboxes")
    .select("id")
    .eq("purpose", options.purpose);
  if (sandboxError) {
    throw new Error(`sweepTestSandboxes failed: ${sandboxError.message}`);
  }

  let deleted = 0;
  for (const row of sandboxes ?? []) {
    const { data, error } = await db.rpc("delete_test_sandbox", {
      p_sandbox_id: row.id,
    });
    if (error) {
      throw new Error(`sweepTestSandboxes failed: ${error.message}`);
    }
    if (data === true) deleted += 1;
  }

  const { data: legacy, error } = await db
    .from("workspaces")
    .delete()
    .eq("purpose", "internal_test")
    .like("name", `${options.prefix}%`)
    .select("id");
  if (error) {
    throw new Error(`sweepTestSandboxes failed: ${error.message}`);
  }
  return deleted + (legacy?.length ?? 0);
}
