import { Router } from "express";
import { authMode } from "@/lib/api/v1/auth";

export const healthRouter = Router();

// GET /api/v1/health — liveness probe used by Railway's healthcheck.
//
// `commit` reports the build that is actually live. Railway's native GitHub
// deploys set RAILWAY_GIT_COMMIT_SHA; APP_COMMIT_SHA is only a legacy fallback
// for older CLI-driven deploys. The verification workflow polls this field
// until prod serves the pushed commit, so "what commit is live?" is answerable
// with one curl.
healthRouter.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    authMode: authMode(),
    commit:
      process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.APP_COMMIT_SHA ?? null,
    time: new Date().toISOString(),
  });
});
