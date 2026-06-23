// Must be first: loads the repo-root env files before anything reads process.env.
import "./env.js";
import { createServer } from "./server.js";

const port = Number(process.env.PORT || 4000);
const shutdownGraceMs = Number(process.env.SHUTDOWN_GRACE_MS || 115_000);

const app = createServer();

const server = app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] Express listening on :${port} (${process.env.NODE_ENV || "development"})`);
});

let shuttingDown = false;

function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  const startedAt = Date.now();
  // eslint-disable-next-line no-console
  console.log(`[api] received ${signal}; draining HTTP server for up to ${shutdownGraceMs}ms`);

  const forceExit = setTimeout(() => {
    // eslint-disable-next-line no-console
    console.error(`[api] forced shutdown after ${shutdownGraceMs}ms`);
    process.exit(1);
  }, shutdownGraceMs);
  forceExit.unref();

  server.close((err) => {
    clearTimeout(forceExit);
    const durationMs = Date.now() - startedAt;
    if (err) {
      // eslint-disable-next-line no-console
      console.error(`[api] HTTP server drain failed after ${durationMs}ms`, err);
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log(`[api] HTTP server drained in ${durationMs}ms`);
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
