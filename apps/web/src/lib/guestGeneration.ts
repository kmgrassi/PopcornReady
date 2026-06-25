import type { NavigateFunction } from "react-router-dom";
import type { StartRunResult } from "./startRun";
import { createAndStartRun } from "./startRun";
import {
  buildQuickStartBriefDraft,
  quickStartSignupState,
} from "./quickStartRun";
import {
  GUEST_RUN_LIMIT,
  getGuestRunLimitState,
} from "./guestRunLimit";

export const GUEST_RUN_ALLOWANCE = GUEST_RUN_LIMIT;

const PENDING_PROMPT_STORAGE_KEY = "pr.pendingLandingPrompt";
export interface PendingLandingPrompt {
  goal: string;
  targetLengthSec: number;
  createdAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
  return getGuestRunLimitState().remaining;
}

export function canStartGuestRun(): boolean {
  return guestRunGuardRemaining() > 0;
}

function landingPromptQuickStartInput(prompt: PendingLandingPrompt) {
  return {
    goal: prompt.goal,
    lengthSec: prompt.targetLengthSec,
  };
}

export function pendingLandingPromptNavigationState(prompt: PendingLandingPrompt) {
  persistPendingLandingPrompt(prompt);
  return {
    pendingLandingPrompt: prompt,
    ...quickStartSignupState(landingPromptQuickStartInput(prompt)),
  };
}

export async function startPendingLandingPromptRun(
  prompt: PendingLandingPrompt,
  options: { enforceGuestRunLimit?: boolean } = {},
): Promise<StartRunResult> {
  persistPendingLandingPrompt(prompt);
  const draft = buildQuickStartBriefDraft(landingPromptQuickStartInput(prompt));
  return createAndStartRun(draft, options);
}

export function continuePendingLandingPrompt(
  navigate: NavigateFunction,
  prompt: PendingLandingPrompt,
): void {
  navigate("/dashboard", {
    state: pendingLandingPromptNavigationState(prompt),
  });
}
