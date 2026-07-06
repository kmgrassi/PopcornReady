// Browser client for the generation-run polling, retry, and cancel endpoints
// defined in docs/scopes/generation-progress-ui.md.
//
// PR #8 owns the cancel/retry/recovery flows that call these helpers. The
// underlying HTTP endpoints are PR #4's deliverable and do not exist yet, so
// this client is a thin wrapper that returns a typed error envelope when the
// route is missing instead of throwing an opaque fetch error.

import {
  type GateableGenerationStageType,
  GenerationErrorSummary,
  GenerationRun,
} from "@popcorn/shared/v1/types";
import { authenticatedFetch } from "../../supabase/fetch";
import { GenerationRunDetail } from "./status";

export interface GenerationRunClientOptions {
  // Defaults to the global `fetch`. Injected in tests.
  fetchImpl?: typeof fetch;
  // Defaults to "". Set to point at a different origin (eg. server-side calls
  // during recovery).
  baseUrl?: string;
}

export interface ListGenerationRunsResponse {
  runs: GenerationRun[];
}

export interface RetryGenerationRunOptions {
  // Optional stage or stage-item scope. The open decision in the scope doc
  // leaves the granularity to V1 — surface both so callers can pick.
  stageId?: string;
  itemId?: string;
}

export interface RejectGenerationRunOptions {
  stageType?: GateableGenerationStageType;
  note?: string;
}

type JsonRecord = Record<string, unknown>;

interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: GenerationErrorSummary;
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGenerationRun(value: unknown): value is GenerationRun {
  return (
    isRecord(value) &&
    typeof value.runId === "string" &&
    typeof value.projectId === "string" &&
    typeof value.status === "string"
  );
}

function isListGenerationRunsResponse(value: unknown): value is ListGenerationRunsResponse {
  return isRecord(value) && Array.isArray(value.runs) && value.runs.every(isGenerationRun);
}

function isGenerationRunDetail(value: unknown): value is GenerationRunDetail {
  return (
    isRecord(value) &&
    isGenerationRun(value.run) &&
    Array.isArray(value.stages) &&
    Array.isArray(value.stageItems) &&
    (value.resultArtifacts === undefined || Array.isArray(value.resultArtifacts))
  );
}

async function readJson<T>(
  response: Response,
  guard: (value: unknown) => value is T,
  invalidMessage: string,
): Promise<T> {
  const payload = (await response.json()) as unknown;
  if (!guard(payload)) {
    throw new GenerationRunRequestError(502, "invalid_response_shape", invalidMessage);
  }
  return payload;
}

export class GenerationRunRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly summary?: GenerationErrorSummary;

  constructor(status: number, code: string, message: string, summary?: GenerationErrorSummary) {
    super(message);
    this.name = "GenerationRunRequestError";
    this.status = status;
    this.code = code;
    this.summary = summary;
  }
}

export class GenerationRunClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(options: GenerationRunClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? authenticatedFetch;
    this.baseUrl = options.baseUrl ?? apiBaseUrl();
  }

  async listRuns(projectId: string, signal?: AbortSignal): Promise<GenerationRun[]> {
    const response = await this.request(
      "GET",
      `/api/v1/projects/${encodeURIComponent(projectId)}/generation-runs`,
      undefined,
      signal,
    );
    const body = await readJson(
      response,
      isListGenerationRunsResponse,
      "Generation-run list response was missing a runs array.",
    );
    return body.runs ?? [];
  }

  async getRun(
    projectId: string,
    runId: string,
    signal?: AbortSignal,
  ): Promise<GenerationRunDetail> {
    const response = await this.request(
      "GET",
      `/api/v1/projects/${encodeURIComponent(projectId)}/generation-runs/${encodeURIComponent(runId)}`,
      undefined,
      signal,
    );
    return readJson(
      response,
      isGenerationRunDetail,
      "Generation-run detail response was malformed.",
    );
  }

  async cancelRun(
    projectId: string,
    runId: string,
    signal?: AbortSignal,
  ): Promise<GenerationRunDetail> {
    const response = await this.request(
      "POST",
      `/api/v1/projects/${encodeURIComponent(projectId)}/generation-runs/${encodeURIComponent(runId)}/cancel`,
      {},
      signal,
    );
    return readJson(
      response,
      isGenerationRunDetail,
      "Generation-run cancel response was malformed.",
    );
  }

  async retryRun(
    projectId: string,
    runId: string,
    options: RetryGenerationRunOptions = {},
    signal?: AbortSignal,
  ): Promise<GenerationRunDetail> {
    const body: Partial<Record<"stageId" | "itemId", string>> = {};
    if (options.stageId) body.stageId = options.stageId;
    if (options.itemId) body.itemId = options.itemId;
    const response = await this.request(
      "POST",
      `/api/v1/projects/${encodeURIComponent(projectId)}/generation-runs/${encodeURIComponent(runId)}/retry`,
      body,
      signal,
    );
    return readJson(
      response,
      isGenerationRunDetail,
      "Generation-run retry response was malformed.",
    );
  }

  async approveRun(
    projectId: string,
    runId: string,
    signal?: AbortSignal,
  ): Promise<GenerationRunDetail> {
    const response = await this.request(
      "POST",
      `/api/v1/projects/${encodeURIComponent(projectId)}/generation-runs/${encodeURIComponent(runId)}/approve`,
      {},
      signal,
    );
    return readJson(
      response,
      isGenerationRunDetail,
      "Generation-run approve response was malformed.",
    );
  }

  async rejectRun(
    projectId: string,
    runId: string,
    options: RejectGenerationRunOptions = {},
    signal?: AbortSignal,
  ): Promise<GenerationRunDetail> {
    const body: Partial<Record<"stageType" | "note", string>> = {};
    if (options.stageType) body.stageType = options.stageType;
    if (options.note) body.note = options.note;
    const response = await this.request(
      "POST",
      `/api/v1/projects/${encodeURIComponent(projectId)}/generation-runs/${encodeURIComponent(runId)}/reject`,
      body,
      signal,
    );
    return readJson(
      response,
      isGenerationRunDetail,
      "Generation-run reject response was malformed.",
    );
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    const init: RequestInit = {
      method,
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-store",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      signal,
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);

    if (!response.ok) {
      throw await toRequestError(response);
    }

    return response;
  }
}

function apiBaseUrl(): string {
  return (import.meta.env.VITE_API_URL?.trim() || "").replace(/\/$/, "");
}

async function toRequestError(response: Response): Promise<GenerationRunRequestError> {
  let code = `http_${response.status}`;
  let message = response.statusText || "Generation-run request failed";
  let summary: GenerationErrorSummary | undefined;

  try {
    const payload = (await response.clone().json()) as unknown;
    if (!isRecord(payload)) {
      return new GenerationRunRequestError(response.status, code, message, summary);
    }
    const errorPayload = payload as ApiErrorPayload;
    if (errorPayload.error?.code) code = errorPayload.error.code;
    if (errorPayload.error?.message) message = errorPayload.error.message;
    if (errorPayload.error?.details) summary = errorPayload.error.details;
  } catch {
    // Body wasn't JSON. Fall back to status-derived code/message.
  }

  return new GenerationRunRequestError(response.status, code, message, summary);
}
