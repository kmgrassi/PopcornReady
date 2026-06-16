// Dev-only browser fixture endpoints. Mounted only when ENABLE_WEB_E2E_HARNESS
// is set outside production so Playwright can create and clean up real
// internal_test sandboxes over HTTP.

import { Router, type RequestHandler } from "express";

import { ApiError } from "@/core/errors";
import {
  createWebE2ESandbox,
  sweepWebE2ESandboxes,
  teardownWebE2ESandbox,
} from "@/lib/test-sandboxes/web-e2e";

export function isWebE2EHarnessEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = String(env.ENABLE_WEB_E2E_HARNESS || "").trim().toLowerCase();
  const enabled = flag === "1" || flag === "true";
  return enabled && env.NODE_ENV !== "production";
}

export const devWebE2ERouter = Router();

function devRoute(
  fn: (req: Parameters<RequestHandler>[0]) => Promise<{ status: number; body: unknown }>
): RequestHandler {
  return async (req, res) => {
    try {
      const result = await fn(req);
      res.status(result.status).json(result.body);
    } catch (err) {
      const apiError =
        err instanceof ApiError
          ? err
          : new ApiError(
              "internal_error",
              err instanceof Error ? err.message : "Internal error."
            );
      res.status(apiError.status).json(apiError.envelope(req.requestId));
    }
  };
}

// POST /api/v1/dev/web-e2e/sandboxes
// Body: { projectName?, featureSet?, ttlMs? }
devWebE2ERouter.post(
  "/dev/web-e2e/sandboxes",
  devRoute(async (req) => {
    const body = (req.body ?? {}) as {
      projectName?: unknown;
      featureSet?: unknown;
      ttlMs?: unknown;
    };
    const featureSet =
      Array.isArray(body.featureSet) && body.featureSet.every((item) => typeof item === "string")
        ? body.featureSet
        : undefined;
    const sandbox = await createWebE2ESandbox({
      projectName: typeof body.projectName === "string" ? body.projectName : undefined,
      featureSet,
      ttlMs:
        typeof body.ttlMs === "number" && Number.isFinite(body.ttlMs) && body.ttlMs > 0
          ? body.ttlMs
          : undefined,
    });
    return { status: 201, body: { sandbox } };
  })
);

// DELETE /api/v1/dev/web-e2e/sandboxes/:sandboxId
// Body: { workspaceId, workspaceName }
devWebE2ERouter.delete(
  "/dev/web-e2e/sandboxes/:sandboxId",
  devRoute(async (req) => {
    const body = (req.body ?? {}) as { workspaceId?: unknown; workspaceName?: unknown };
    if (typeof body.workspaceId !== "string" || typeof body.workspaceName !== "string") {
      throw new ApiError(
        "validation_failed",
        "workspaceId and workspaceName are required to delete a web e2e sandbox."
      );
    }
    const deleted = await teardownWebE2ESandbox({
      sandboxId: req.params.sandboxId,
      workspaceId: body.workspaceId,
      workspaceName: body.workspaceName,
    });
    return { status: 200, body: { deleted } };
  })
);

// POST /api/v1/dev/web-e2e/sandboxes/sweep
devWebE2ERouter.post(
  "/dev/web-e2e/sandboxes/sweep",
  devRoute(async () => {
    const deleted = await sweepWebE2ESandboxes();
    return { status: 200, body: { deleted } };
  })
);
