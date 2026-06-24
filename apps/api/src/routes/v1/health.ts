import { Router } from "express";
import { authMode } from "@/lib/api/v1/auth";

export const healthRouter = Router();

// GET /api/v1/health — liveness probe used by Railway's healthcheck.
//
// `commit` reports the build that is actually live. The deploy workflow
// (.github/workflows/deploy-api.yml) stamps APP_COMMIT_SHA and then polls this
// field until prod serves the just-shipped commit, so a build that succeeds but
// fails to boot/healthcheck fails the deploy instead of silently leaving prod on
// an old image. It also makes "what commit is live?" answerable with one curl.
healthRouter.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    authMode: authMode(),
    commit:
      process.env.APP_COMMIT_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
    time: new Date().toISOString(),
  });
});
