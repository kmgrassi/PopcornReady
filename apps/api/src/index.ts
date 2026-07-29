// Must be first: loads the repo-root env files before anything reads process.env.
import "./env.js";
import { startGuestRetentionScheduler } from "./lib/api/v1/guest-retention.js";
import { startOrchestratorRecoveryWorker } from "./lib/orchestrator/recovery-worker.js";
import { closePostgresPool } from "./lib/postgres/transactions.js";
import { createServer } from "./server.js";

const port = Number(process.env.PORT || 4000);
const shutdownGraceMs = Number(process.env.SHUTDOWN_GRACE_MS || 115_000);

const app = createServer();
const guestRetentionTimer = startGuestRetentionScheduler();
const orchestratorRecoveryTimer = startOrchestratorRecoveryWorker();

const server = app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] Express listening on :${port} (${process.env.NODE_ENV || "development"})`);
});

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (guestRetentionTimer) clearInterval(guestRetentionTimer);
  if (orchestratorRecoveryTimer) clearInterval(orchestratorRecoveryTimer);
  const startedAt = Date.now();
  // eslint-disable-next-line no-console
  console.log(`[api] received ${signal}; draining HTTP server for up to ${shutdownGraceMs}ms`);

  const forceExit = setTimeout(() => {
    // eslint-disable-next-line no-console
    console.error(`[api] forced shutdown after ${shutdownGraceMs}ms`);
    process.exit(1);
  }, shutdownGraceMs);
  forceExit.unref();

  void (async () => {
    let exitCode = 0;
    const httpError = await new Promise<Error | undefined>((resolve) => {
      server.close((err) => resolve(err));
    });
    const durationMs = Date.now() - startedAt;
    if (httpError) {
      // eslint-disable-next-line no-console
      console.error(
        `[api] HTTP server drain failed after ${durationMs}ms`,
        httpError
      );
      exitCode = 1;
    } else {
      // eslint-disable-next-line no-console
      console.log(`[api] HTTP server drained in ${durationMs}ms`);
    }

    try {
      await closePostgresPool();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[api] Postgres pool drain failed", {
        name: error instanceof Error ? error.name : "UnknownPoolDrainError",
      });
      exitCode = 1;
    }

    clearTimeout(forceExit);
    process.exit(exitCode);
  })();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
