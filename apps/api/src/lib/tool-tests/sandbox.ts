// Throwaway workspace + project lifecycle for end-to-end tool tests. Each case
// runs against its own sandbox so real INSERTs are exercised and then fully
// removed through the shared test-sandbox cleanup path.

import {
  createTestSandbox,
  sweepTestSandboxes,
  teardownTestSandbox,
} from "@/lib/test-sandboxes/sandbox";
import { assertDeletableSandboxName, TEST_WORKSPACE_PREFIX } from "./sandbox-guard";
import type { Sandbox } from "./types";

export { TEST_WORKSPACE_PREFIX, assertDeletableSandboxName } from "./sandbox-guard";

// Create a uniquely-named sandbox workspace (unowned, matched by name) plus an
// empty project for tools to write into.
export async function createSandbox(): Promise<Sandbox> {
  const sandbox = await createTestSandbox({
    prefix: TEST_WORKSPACE_PREFIX,
    purpose: "tool-test",
    projectName: "tool-test sandbox project",
  });
  return {
    workspaceId: sandbox.workspaceId,
    projectId: sandbox.projectId,
    workspaceName: sandbox.workspaceName,
    sandboxId: sandbox.sandboxId,
  };
}

// Delete the sandbox workspace (cascades to everything under it). Guarded twice:
// the name must carry the test prefix, and the DELETE itself is constrained to
// rows whose name matches the prefix.
export async function teardownSandbox(sandbox: Sandbox): Promise<void> {
  assertDeletableSandboxName(sandbox.workspaceName);
  await teardownTestSandbox({ ...sandbox, prefix: TEST_WORKSPACE_PREFIX });
}

// Remove any sandbox workspaces left behind by crashed runs. Returns the count
// deleted. Run at the start of a suite.
export async function sweepOrphanSandboxes(): Promise<number> {
  return sweepTestSandboxes({ prefix: TEST_WORKSPACE_PREFIX, purpose: "tool-test" });
}
