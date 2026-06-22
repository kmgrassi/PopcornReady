const STORAGE_KEY = "pr.guestRuns";

export const GUEST_RUN_LIMIT = 1;
export const GUEST_RUN_WINDOW_MS = 24 * 60 * 60 * 1000;

type GuestRunRecord = {
  count: number;
  firstRunAt: number;
};

export type GuestRunLimitState = {
  limit: number;
  remaining: number;
  windowMs: number;
  resetsAt: number | null;
  isLimited: boolean;
};

export class GuestRunLimitError extends Error {
  readonly state: GuestRunLimitState;

  constructor(state: GuestRunLimitState) {
    super("Create an account to make more videos.");
    this.name = "GuestRunLimitError";
    this.state = state;
  }
}

function readRecord(now: number): GuestRunRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GuestRunRecord>;
    if (
      typeof parsed.count !== "number" ||
      typeof parsed.firstRunAt !== "number" ||
      !Number.isFinite(parsed.count) ||
      !Number.isFinite(parsed.firstRunAt)
    ) {
      return null;
    }
    if (now - parsed.firstRunAt >= GUEST_RUN_WINDOW_MS) return null;
    return {
      count: Math.max(0, Math.floor(parsed.count)),
      firstRunAt: parsed.firstRunAt,
    };
  } catch {
    return null;
  }
}

function writeRecord(record: GuestRunRecord): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // localStorage is a UX brake, not the security boundary. If persistence is
    // unavailable, let the server-side anonymous quota be the source of truth.
  }
}

export function getGuestRunLimitState(now = Date.now()): GuestRunLimitState {
  const record = readRecord(now);
  const count = record?.count ?? 0;
  const remaining = Math.max(0, GUEST_RUN_LIMIT - count);
  return {
    limit: GUEST_RUN_LIMIT,
    remaining,
    windowMs: GUEST_RUN_WINDOW_MS,
    resetsAt: record ? record.firstRunAt + GUEST_RUN_WINDOW_MS : null,
    isLimited: remaining <= 0,
  };
}

export function assertGuestRunAllowed(now = Date.now()): GuestRunLimitState {
  const state = getGuestRunLimitState(now);
  if (state.isLimited) {
    throw new GuestRunLimitError(state);
  }
  return state;
}

export function recordGuestRunStarted(now = Date.now()): GuestRunLimitState {
  const record = readRecord(now);
  const next: GuestRunRecord = record
    ? { ...record, count: record.count + 1 }
    : { count: 1, firstRunAt: now };
  writeRecord(next);
  return getGuestRunLimitState(now);
}

