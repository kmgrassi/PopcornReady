import { ApiError } from "../../core/errors";
import { rootLogger, type Logger } from "../v1/logger";

export const PGRST_NO_ROWS = "PGRST116";

export interface SupabaseErrorLike {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

export function isMissingRow(error: SupabaseErrorLike | null): boolean {
  return error?.code === PGRST_NO_ROWS;
}

export function databaseError(
  operation: string,
  error: SupabaseErrorLike | null
): ApiError {
  const dbCode = error?.code ?? "unknown";
  const dbMessage = error?.message ?? "Unknown database error.";
  return new ApiError(
    "database_error",
    `Database operation failed: ${operation}.`,
    {
      operation,
      dbCode,
      dbMessage,
      ...(error?.details ? { dbDetails: error.details } : {}),
      ...(error?.hint ? { dbHint: error.hint } : {}),
    }
  );
}

export function throwDatabaseError(
  operation: string,
  error: SupabaseErrorLike | null
): void {
  if (error) throw databaseError(operation, error);
}

// ---------------------------------------------------------------------------
// runQuery — the single wrapper every store call site should go through.
//
// The hand-written `const { data, error } = await db.from(...); if (error)
// throwDatabaseError(...)` pattern made the error check OPT-IN: any call site
// that forgot the check silently swallowed the failure and used a null `data`.
// runQuery EXECUTES the query so the check (and the structured log line) can no
// longer be skipped — reads and writes alike surface the same typed
// `database_error` envelope, and operators get one `db_error` event per failure.
//
// supabase-js query builders are thenable (PromiseLike) and resolve to
// `{ data, error }`, so a builder can be passed directly:
//
//   const project = await runQuery(
//     "store.getProject",
//     db.from("projects").select("*").eq("id", id).single(),
//     { allowMissing: true }            // PGRST116 -> null instead of throwing
//   );
//
// For call sites that must branch on a specific Postgres error (e.g. a unique
// violation that triggers a re-read), keep inspecting `{ data, error }` by hand
// and surface the failure with databaseError(); runQuery covers the uniform
// throw-or-return-data majority, not those bespoke branches.
// ---------------------------------------------------------------------------

export type SupabaseResult<T> = {
  data: T;
  error: SupabaseErrorLike | null;
};

export interface RunQueryOptions {
  /**
   * Treat a PostgREST "no rows" result (PGRST116, from `.single()`) as a
   * successful `null` rather than throwing. Use for reads where "absent" is a
   * normal outcome the caller handles.
   */
  allowMissing?: boolean;
  /** Logger to emit the `db_error` event on; defaults to the root logger. */
  logger?: Pick<Logger, "error">;
}

/**
 * Awaits a Supabase query, surfaces any error as a typed `database_error`
 * ApiError (after logging a structured `db_error` event), and returns the data.
 *
 * `operation` is a short, stable label (e.g. "store.createProject insert") that
 * flows into both the log line and the error envelope so a failure is traceable
 * to its call site.
 *
 * With `allowMissing`, a `.single()` that found no row resolves to `null`
 * instead of throwing — the return type widens to `T | null` for that caller.
 */
export async function runQuery<T>(
  operation: string,
  query: PromiseLike<SupabaseResult<T>>,
  options: { allowMissing: true; logger?: Pick<Logger, "error"> }
): Promise<T | null>;
export async function runQuery<T>(
  operation: string,
  query: PromiseLike<SupabaseResult<T>>,
  options?: RunQueryOptions
): Promise<T>;
export async function runQuery<T>(
  operation: string,
  query: PromiseLike<SupabaseResult<T>>,
  options: RunQueryOptions = {}
): Promise<T | null> {
  const { data, error } = await query;
  if (error) {
    if (options.allowMissing && isMissingRow(error)) return null;
    (options.logger ?? rootLogger).error("db_error", {
      operation,
      error: { code: error.code, message: error.message },
    });
    throw databaseError(operation, error);
  }
  return data;
}
