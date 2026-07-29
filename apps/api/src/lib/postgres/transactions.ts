import { Pool, type PoolClient, type PoolConfig } from "pg";

type TransactionPool = Pick<Pool, "connect">;
type TransactionClient = Pick<PoolClient, "query" | "release">;

const DEFAULT_POOL_MAX = 5;
const MAX_POOL_MAX = 20;
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000;
const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

let activePool: Pool | null = null;

function integerSetting(
  name: string,
  fallback: number,
  bounds: { min: number; max: number }
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < bounds.min || value > bounds.max) {
    throw new Error(
      `${name} must be an integer between ${bounds.min} and ${bounds.max}`
    );
  }
  return value;
}

export function postgresPoolConfig(): PoolConfig {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is required when a direct Postgres transaction is used"
    );
  }

  return {
    connectionString,
    max: integerSetting("DATABASE_POOL_MAX", DEFAULT_POOL_MAX, {
      min: 1,
      max: MAX_POOL_MAX,
    }),
    connectionTimeoutMillis: integerSetting(
      "DATABASE_CONNECTION_TIMEOUT_MS",
      DEFAULT_CONNECTION_TIMEOUT_MS,
      { min: 100, max: 60_000 }
    ),
    idleTimeoutMillis: integerSetting(
      "DATABASE_IDLE_TIMEOUT_MS",
      DEFAULT_IDLE_TIMEOUT_MS,
      { min: 1_000, max: 600_000 }
    ),
    statement_timeout: integerSetting(
      "DATABASE_STATEMENT_TIMEOUT_MS",
      DEFAULT_STATEMENT_TIMEOUT_MS,
      { min: 100, max: 600_000 }
    ),
    idle_in_transaction_session_timeout: integerSetting(
      "DATABASE_IDLE_TRANSACTION_TIMEOUT_MS",
      DEFAULT_STATEMENT_TIMEOUT_MS,
      { min: 100, max: 600_000 }
    ),
    application_name:
      process.env.DATABASE_APPLICATION_NAME || "popcornready-api",
  };
}

function getPostgresPool(): Pool {
  if (activePool) return activePool;
  const pool = new Pool(postgresPoolConfig());
  pool.on("error", (error) => {
    // Do not log connection strings, query text, or server parameters.
    console.error("[db] idle Postgres client error", {
      name: error.name,
      code: "code" in error ? error.code : undefined,
    });
  });
  activePool = pool;
  return pool;
}

export function createTransactionRunner(pool: TransactionPool) {
  return async function runTransaction<T>(
    operation: string,
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = (await pool.connect()) as TransactionClient;
    let began = false;

    try {
      await client.query("BEGIN");
      began = true;
      const result = await callback(client as PoolClient);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      if (began) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          console.error("[db] Postgres rollback failed", {
            operation,
            name:
              rollbackError instanceof Error
                ? rollbackError.name
                : "UnknownRollbackError",
          });
        }
      }
      throw error;
    } finally {
      client.release();
    }
  };
}

export async function withTransaction<T>(
  operation: string,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  return createTransactionRunner(getPostgresPool())(operation, callback);
}

export async function closePostgresPool(): Promise<void> {
  const pool = activePool;
  activePool = null;
  await closePool(pool);
}

export async function closePool(
  pool: Pick<Pool, "end"> | null
): Promise<void> {
  if (pool) await pool.end();
}
