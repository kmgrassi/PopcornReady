// Typed error envelope for the versioned agent API.
// Codes are stable and machine-readable per docs/scopes/api-contract-v1.md.

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation_failed"
  | "idempotency_conflict"
  | "asset_not_ready"
  | "asset_invalid"
  | "asset_not_transcribable"
  | "no_audio_stream"
  | "object_not_found"
  | "object_too_large"
  | "media_unreadable"
  | "account_collision"
  | "prompt_required"
  | "brief_missing"
  | "timeline_invalid"
  | "job_not_cancelable"
  | "budget_exceeded"
  | "insufficient_credits"
  | "job_failed"
  | "render_failed"
  | "model_output_invalid"
  | "rate_limited"
  | "not_implemented"
  | "database_error"
  | "internal_error";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 400,
  idempotency_conflict: 409,
  asset_not_ready: 409,
  asset_invalid: 400,
  asset_not_transcribable: 422,
  no_audio_stream: 422,
  object_not_found: 404,
  object_too_large: 413,
  media_unreadable: 422,
  account_collision: 409,
  // The caller must supply a prompt because the asset has none stored to reuse.
  prompt_required: 422,
  brief_missing: 400,
  timeline_invalid: 400,
  job_not_cancelable: 409,
  budget_exceeded: 409,
  insufficient_credits: 409,
  job_failed: 422,
  render_failed: 500,
  model_output_invalid: 502,
  rate_limited: 429,
  not_implemented: 501,
  database_error: 500,
  internal_error: 500,
};

export interface FieldError {
  path: string;
  message: string;
}

export interface ApiErrorDetails {
  fields?: FieldError[];
  [key: string]: unknown;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: ApiErrorDetails;

  constructor(code: ApiErrorCode, message: string, details?: ApiErrorDetails) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }

  // Canonical error body shape returned by every v1 route.
  envelope(requestId: string) {
    return {
      error: {
        code: this.code,
        message: this.message,
        requestId,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export function statusForCode(code: ApiErrorCode): number {
  return STATUS_BY_CODE[code];
}

export function validationError(message: string, fields?: FieldError[]): ApiError {
  return new ApiError("validation_failed", message, fields ? { fields } : undefined);
}

export function notFound(message: string): ApiError {
  return new ApiError("not_found", message);
}
