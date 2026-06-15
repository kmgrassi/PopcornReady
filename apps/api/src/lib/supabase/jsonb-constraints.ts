// Faithful JS ports of the Postgres JSONB CHECK constraints that guard our
// schema-marked document columns. These mirror the SQL exactly so tests (and, if
// useful, write-time pre-validation) can detect a payload shape that Postgres
// would reject — the class of bug where application code writes a JSONB shape the
// DB constraint forbids and the failure only surfaces at runtime against the real
// database.
//
// SOURCES (keep in sync — if a migration changes a constraint, update here):
//   supabase/migrations/20260610130000_storyboard_relational_model.sql
//     assets_content_schema_check, assets_params_schema_check,
//     actions_params_schema_check, actions_proposal_schema_check,
//     actions_error_schema_check
//   supabase/migrations/20260610140000_generation_runs_gates_schema_check.sql
//     generation_runs_gates_schema_check
//
// Postgres class_23 integrity-constraint violation; check_violation is 23514.
export const CHECK_VIOLATION = "23514";

// Mirror of jsonb_typeof(): JSON null/array/object are all `typeof === "object"`
// in JS, but Postgres reports them distinctly. The constraints branch on these
// exact tags, so the port must too.
export type JsonbType =
  | "null"
  | "array"
  | "object"
  | "string"
  | "number"
  | "boolean";

export function jsonbTypeof(value: unknown): JsonbType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "object") return "object";
  if (t === "string") return "string";
  if (t === "number" || t === "bigint") return "number";
  if (t === "boolean") return "boolean";
  // undefined / function / symbol have no JSONB representation; treat as null so
  // they fall through to the null-handling branch of each constraint.
  return "null";
}

// `jsonb_typeof(col) = 'object' and (col ? 'schema' or col ? 'schema_version')`
// — the schema-marker shape required of every primary document payload.
export function hasSchemaMarker(value: unknown): boolean {
  return (
    jsonbTypeof(value) === "object" &&
    (Object.prototype.hasOwnProperty.call(value, "schema") ||
      Object.prototype.hasOwnProperty.call(value, "schema_version"))
  );
}

// `jsonb_typeof(col) = 'array' and not jsonb_path_exists(col, '$[*] ? (@.type() != "string")')`
// — an array whose every element is a string (the empty array passes).
export function isStringArray(value: unknown): boolean {
  return (
    jsonbTypeof(value) === "array" &&
    (value as unknown[]).every((el) => jsonbTypeof(el) === "string")
  );
}

// `col = '{}'::jsonb` — the empty object, allowed by the *params* constraints as
// an "unset" sentinel.
function isEmptyObject(value: unknown): boolean {
  return jsonbTypeof(value) === "object" && Object.keys(value as object).length === 0;
}

export interface JsonbConstraint {
  /** Constraint name as it appears in Postgres (and in error messages). */
  name: string;
  table: string;
  column: string;
  /** True when the column value satisfies the constraint. */
  check(value: unknown): boolean;
}

// The registry below is the single source of truth the test fake validates
// against. One entry per CHECK constraint on a schema-marked JSONB column.
export const JSONB_CONSTRAINTS: readonly JsonbConstraint[] = [
  {
    name: "generation_runs_gates_schema_check",
    table: "generation_runs",
    column: "gates",
    // Object with a schema marker, OR the flat string-array bridge. A SQL CHECK
    // also passes when the expression is NULL, so a null/absent column passes;
    // NOT NULL (if any) is enforced separately by the column definition.
    check: (value) =>
      value == null || hasSchemaMarker(value) || isStringArray(value),
  },
  {
    name: "assets_content_schema_check",
    table: "assets",
    column: "content",
    check: (value) => value == null || hasSchemaMarker(value),
  },
  {
    name: "assets_params_schema_check",
    table: "assets",
    column: "params",
    check: (value) => value == null || isEmptyObject(value) || hasSchemaMarker(value),
  },
  {
    name: "actions_params_schema_check",
    table: "actions",
    column: "params",
    // NB: actions.params has no `is null` branch in SQL — `'{}'` or a marked
    // object only.
    check: (value) => isEmptyObject(value) || hasSchemaMarker(value),
  },
  {
    name: "actions_proposal_schema_check",
    table: "actions",
    column: "proposal",
    check: (value) => value == null || hasSchemaMarker(value),
  },
  {
    name: "actions_error_schema_check",
    table: "actions",
    column: "error",
    check: (value) => value == null || hasSchemaMarker(value),
  },
] as const;

export interface ConstraintViolation {
  constraint: string;
  table: string;
  column: string;
  value: unknown;
}

// Run every JSONB constraint registered for `table` against the candidate row.
// Returns the first violation (mirroring Postgres failing the write on the first
// unsatisfied CHECK) or null when the row passes all of them.
export function firstJsonbViolation(
  table: string,
  row: Record<string, unknown>
): ConstraintViolation | null {
  for (const constraint of JSONB_CONSTRAINTS) {
    if (constraint.table !== table) continue;
    if (!(constraint.column in row)) continue;
    const value = row[constraint.column];
    if (!constraint.check(value)) {
      return {
        constraint: constraint.name,
        table,
        column: constraint.column,
        value,
      };
    }
  }
  return null;
}
