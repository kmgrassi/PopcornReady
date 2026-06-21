import { ApiError } from "./errors";

export function parsePagination(searchParams: URLSearchParams): {
  limit: number;
  cursor: string | null;
} {
  const rawLimit = searchParams.get("limit");
  let limit = 50;
  if (rawLimit !== null) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      throw new ApiError("validation_failed", "limit must be an integer between 1 and 100.", {
        fields: [{ path: "limit", message: "Must be an integer between 1 and 100." }],
      });
    }
    limit = parsed;
  }
  return { limit, cursor: searchParams.get("cursor") };
}

