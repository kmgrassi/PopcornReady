import type { FieldError } from "./errors";
import { validationError } from "./errors";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireString(
  value: unknown,
  path: string,
  fields: FieldError[]
): string | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    fields.push({ path, message: "Must be a non-empty string." });
    return undefined;
  }
  return value.trim();
}

export function optionalString(
  value: unknown,
  path: string,
  fields: FieldError[]
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    fields.push({ path, message: "Must be a string." });
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function optionalStringArray(
  value: unknown,
  path: string,
  fields: FieldError[]
): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    fields.push({ path, message: "Must be an array of strings." });
    return undefined;
  }
  return value as string[];
}

export function optionalBoolean(
  value: unknown,
  path: string,
  fields: FieldError[]
): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    fields.push({ path, message: "Must be a boolean." });
    return undefined;
  }
  return value;
}

export function optionalInteger(
  value: unknown,
  path: string,
  fields: FieldError[],
  fallback: number,
  min: number,
  max: number
): number {
  if (value === undefined || value === null) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    fields.push({
      path,
      message: `Must be an integer between ${min} and ${max}.`,
    });
    return fallback;
  }
  return value;
}

export function optionalEnumArray<T extends string>(
  value: unknown,
  allowed: T[],
  path: string,
  fields: FieldError[]
): T[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    fields.push({ path, message: `Must be an array of: ${allowed.join(", ")}.` });
    return undefined;
  }
  const parsed: T[] = [];
  value.forEach((item, index) => {
    if (typeof item !== "string" || !allowed.includes(item as T)) {
      fields.push({
        path: `${path}[${index}]`,
        message: `Must be one of: ${allowed.join(", ")}.`,
      });
      return;
    }
    parsed.push(item as T);
  });
  return parsed;
}

export function parseEnum<T extends string>(
  value: unknown,
  allowed: T[],
  path: string,
  fields: FieldError[]
): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fields.push({ path, message: `Must be one of: ${allowed.join(", ")}.` });
    return undefined;
  }
  return value as T;
}

export function throwIfInvalid(fields: FieldError[]): void {
  if (fields.length > 0) {
    throw validationError("The request body is invalid.", fields);
  }
}

