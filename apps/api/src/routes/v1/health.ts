import { Router } from "express";
import { authMode } from "@/lib/api/v1/auth";
import { creatorDirectDatabaseReadiness } from "@/lib/postgres/creator-direct-readiness";
import { releaseReadiness } from "@/lib/release-readiness";

export const healthRouter = Router();

// GET /api/v1/health — liveness probe used by Railway's healthcheck.
//
// `commit` reports the build that is actually live. Railway's native GitHub
// deploys set RAILWAY_GIT_COMMIT_SHA; APP_COMMIT_SHA is only a legacy fallback
// for older CLI-driven deploys. The verification workflow polls this field
// until prod serves the pushed commit, so "what commit is live?" is answerable
// with one curl.
healthRouter.get("/health", async (req, res) => {
  const [database, release] = await Promise.all([
    creatorDirectDatabaseReadiness(),
    releaseReadiness(),
  ]);
  const ready = database.ready && release.ready;
  const fallbackCommit =
    process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.APP_COMMIT_SHA ?? null;
  res.set("Cache-Control", "no-store");
  res.status(ready ? 200 : 503).json({
    status: ready ? "ok" : "unavailable",
    authMode: authMode(),
    commit: release.manifestReady ? release.gitSha : fallbackCommit,
    release,
    creatorDirectDatabase: database,
    time: new Date().toISOString(),
  });
});
