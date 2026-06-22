import type { NavigateFunction } from "react-router-dom";

export const GUEST_RUN_ALLOWANCE = 1;

const PENDING_PROMPT_STORAGE_KEY = "pr.pendingLandingPrompt";
const GUEST_RUN_GUARD_STORAGE_KEY = "pr.guestRuns";

export interface PendingLandingPrompt {
  goal: string;
  targetLengthSec: number;
  createdAt: string;
}

interface GuestRunGuardRecord {
  count: number;
  firstRunAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeSessionJson(key: string, value: unknown): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Session storage is a progressive enhancement for carrying the prompt
    // through auth redirects. Router state still carries it for same-tab flows.
  }
}

export function buildPendingLandingPrompt(
  goal: string,
  targetLengthSec: number,
): PendingLandingPrompt {
  return {
    goal: goal.trim(),
    targetLengthSec,
    createdAt: new Date().toISOString(),
  };
}

export function persistPendingLandingPrompt(prompt: PendingLandingPrompt): void {
  writeSessionJson(PENDING_PROMPT_STORAGE_KEY, prompt);
}

export function readPendingLandingPrompt(): PendingLandingPrompt | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_PROMPT_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    if (
      !isRecord(value) ||
      typeof value.goal !== "string" ||
      typeof value.targetLengthSec !== "number" ||
      typeof value.createdAt !== "string"
    ) {
      return null;
    }
    return {
      goal: value.goal,
      targetLengthSec: value.targetLengthSec,
      createdAt: value.createdAt,
    };
  } catch {
    return null;
  }
}

export function guestRunGuardRemaining(): number {
  if (typeof window === "undefined") return GUEST_RUN_ALLOWANCE;
  const record = readJson<GuestRunGuardRecord>(GUEST_RUN_GUARD_STORAGE_KEY);
  if (!record || typeof record.count !== "number") return GUEST_RUN_ALLOWANCE;
  return Math.max(0, GUEST_RUN_ALLOWANCE - record.count);
}

export function canStartGuestRun(): boolean {
  return guestRunGuardRemaining() > 0;
}

export function rememberGuestRunStarted(): void {
  if (typeof window === "undefined") return;
  const existing = readJson<GuestRunGuardRecord>(GUEST_RUN_GUARD_STORAGE_KEY);
  const next: GuestRunGuardRecord = {
    count: Math.max(0, existing?.count ?? 0) + 1,
    firstRunAt: existing?.firstRunAt ?? new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(GUEST_RUN_GUARD_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The server-side quota is the real enforcement boundary. This client guard
    // is friction for normal browser sessions and should never be relied on.
  }
}

export function continuePendingLandingPrompt(
  navigate: NavigateFunction,
  prompt: PendingLandingPrompt,
): void {
  persistPendingLandingPrompt(prompt);
  navigate("/dashboard", {
    state: { pendingLandingPrompt: prompt },
  });
}
