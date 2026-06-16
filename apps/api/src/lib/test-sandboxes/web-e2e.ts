import {
  assertDeletableSandboxName,
  createTestSandbox,
  sweepTestSandboxes,
  teardownTestSandbox,
  type TestSandbox,
} from "./sandbox";

export const WEB_E2E_WORKSPACE_PREFIX = "__webe2e__";
export const WEB_E2E_SANDBOX_PURPOSE = "web-e2e";

export interface WebE2ESandbox extends TestSandbox {
  purpose: typeof WEB_E2E_SANDBOX_PURPOSE;
}

export function assertWebE2ESandboxName(name: string): void {
  assertDeletableSandboxName(WEB_E2E_WORKSPACE_PREFIX, name);
}

export async function createWebE2ESandbox(options: {
  projectName?: string;
  featureSet?: string[];
  ttlMs?: number;
} = {}): Promise<WebE2ESandbox> {
  const sandbox = await createTestSandbox({
    prefix: WEB_E2E_WORKSPACE_PREFIX,
    purpose: WEB_E2E_SANDBOX_PURPOSE,
    projectName: options.projectName ?? "web e2e sandbox project",
    featureSet: options.featureSet,
    ttlMs: options.ttlMs,
  });
  return { ...sandbox, purpose: WEB_E2E_SANDBOX_PURPOSE };
}

export function teardownWebE2ESandbox(sandbox: {
  sandboxId?: string;
  workspaceId: string;
  workspaceName: string;
}): Promise<boolean> {
  return teardownTestSandbox({ ...sandbox, prefix: WEB_E2E_WORKSPACE_PREFIX });
}

export function sweepWebE2ESandboxes(): Promise<number> {
  return sweepTestSandboxes({
    prefix: WEB_E2E_WORKSPACE_PREFIX,
    purpose: WEB_E2E_SANDBOX_PURPOSE,
  });
}
