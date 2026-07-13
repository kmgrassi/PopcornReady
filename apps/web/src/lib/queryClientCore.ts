import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { ApiClientError } from "./api-client";
import { showErrorToast, showSuccessToast } from "./toast";

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: QueryToastMeta;
    mutationMeta: QueryToastMeta;
  }
}

interface QueryToastMeta extends Record<string, unknown> {
  errorMessage?: string;
  successMessage?: string;
  suppressErrorToast?: boolean;
}

const DEFAULT_STALE_TIME_MS = 15_000;

function retryApiFailure(failureCount: number, error: Error): boolean {
  if (error instanceof ApiClientError && error.status >= 400 && error.status < 500) {
    return false;
  }
  return failureCount < 2;
}

function errorToastMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Something went wrong. Try again.";
}

const recentToastKeys = new Map<string, number>();

function showDedupedErrorToast(title: string, message: string) {
  const key = `${title}:${message}`;
  const now = Date.now();
  const lastShownAt = recentToastKeys.get(key) ?? 0;
  if (now - lastShownAt < 8_000) return;

  recentToastKeys.set(key, now);
  showErrorToast(title, message);
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      const meta = query.meta;
      if (meta?.suppressErrorToast) return;
      if (query.state.data !== undefined) return;

      showDedupedErrorToast(
        meta?.errorMessage ?? "Could not load data",
        errorToastMessage(error),
      );
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      const meta = mutation.meta;
      if (meta?.suppressErrorToast) return;

      showDedupedErrorToast(
        meta?.errorMessage ?? "Action failed",
        errorToastMessage(error),
      );
    },
    onSuccess: (_data, _variables, _context, mutation) => {
      const message = mutation.meta?.successMessage;
      if (message) {
        showSuccessToast(message);
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: DEFAULT_STALE_TIME_MS,
      retry: retryApiFailure,
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: false,
    },
  },
});
