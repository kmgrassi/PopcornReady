import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthStatus } from "../components/auth/AuthProvider";
import {
  EMPTY_BRIEF_DRAFT,
  type BriefDraft,
} from "../components/studio/useStudioFlow";
import { createAndStartRun, type StartRunResult } from "./startRun";

const PENDING_QUICK_START_STORAGE_KEY = "pr.pendingQuickStart";
const PENDING_QUICK_START_VERSION = 1;
const PENDING_QUICK_START_TTL_MS = 1000 * 60 * 60;
const PENDING_QUICK_START_CLAIM_TIMEOUT_MS = 1000 * 30;

export interface QuickStartInput {
  goal: string;
  lengthSec: number;
}

export interface PendingQuickStartPrompt extends QuickStartInput {
  v: typeof PENDING_QUICK_START_VERSION;
  id: string;
  createdAt: number;
  claimedAt?: number;
}

export interface QuickStartNavigationState {
  pendingQuickStart?: PendingQuickStartPrompt;
}

export interface PendingQuickStartRunState {
  hasPending: boolean;
  starting: boolean;
  error: string | null;
}

function hasSessionStorage(): boolean {
  return typeof window !== "undefined" && Boolean(window.sessionStorage);
}

function newPendingId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeQuickStartInput(input: QuickStartInput): QuickStartInput {
  return {
    goal: input.goal.trim(),
    lengthSec: Math.max(5, Math.round(input.lengthSec)),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPendingQuickStartPrompt(value: unknown): value is PendingQuickStartPrompt {
  return (
    isRecord(value) &&
    value.v === PENDING_QUICK_START_VERSION &&
    typeof value.id === "string" &&
    typeof value.goal === "string" &&
    typeof value.lengthSec === "number" &&
    typeof value.createdAt === "number" &&
    (value.claimedAt === undefined || typeof value.claimedAt === "number")
  );
}

function isExpired(prompt: PendingQuickStartPrompt, now = Date.now()): boolean {
  return now - prompt.createdAt > PENDING_QUICK_START_TTL_MS;
}

function isClaimFresh(prompt: PendingQuickStartPrompt, now = Date.now()): boolean {
  return (
    typeof prompt.claimedAt === "number" &&
    now - prompt.claimedAt < PENDING_QUICK_START_CLAIM_TIMEOUT_MS
  );
}

function writePendingQuickStartPrompt(prompt: PendingQuickStartPrompt): void {
  if (!hasSessionStorage()) return;
  window.sessionStorage.setItem(
    PENDING_QUICK_START_STORAGE_KEY,
    JSON.stringify(prompt),
  );
}

export function buildQuickStartBriefDraft(input: QuickStartInput): BriefDraft {
  const normalized = normalizeQuickStartInput(input);
  return {
    ...EMPTY_BRIEF_DRAFT,
    goal: normalized.goal,
    targetLengthSec: normalized.lengthSec,
  };
}

export async function startQuickStartRun(
  input: QuickStartInput,
): Promise<StartRunResult> {
  const draft = buildQuickStartBriefDraft(input);
  return createAndStartRun(draft);
}

export function runProgressPath({ projectId, runId }: StartRunResult): string {
  return `/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`;
}

export function createPendingQuickStartPrompt(
  input: QuickStartInput,
): PendingQuickStartPrompt {
  const normalized = normalizeQuickStartInput(input);
  return {
    v: PENDING_QUICK_START_VERSION,
    id: newPendingId(),
    goal: normalized.goal,
    lengthSec: normalized.lengthSec,
    createdAt: Date.now(),
  };
}

export function persistPendingQuickStartPrompt(
  input: QuickStartInput,
): PendingQuickStartPrompt {
  const prompt = createPendingQuickStartPrompt(input);
  writePendingQuickStartPrompt(prompt);
  return prompt;
}

export function quickStartSignupState(
  input: QuickStartInput,
): QuickStartNavigationState {
  return {
    pendingQuickStart: persistPendingQuickStartPrompt(input),
  };
}

export function pendingQuickStartFromNavigationState(
  state: unknown,
): PendingQuickStartPrompt | null {
  if (!isRecord(state)) return null;
  const prompt = state.pendingQuickStart;
  return isPendingQuickStartPrompt(prompt) && !isExpired(prompt) ? prompt : null;
}

export function readPendingQuickStartPrompt(): PendingQuickStartPrompt | null {
  if (!hasSessionStorage()) return null;
  const raw = window.sessionStorage.getItem(PENDING_QUICK_START_STORAGE_KEY);
  if (!raw) return null;

  try {
    const prompt = JSON.parse(raw) as unknown;
    if (!isPendingQuickStartPrompt(prompt) || isExpired(prompt)) {
      clearPendingQuickStartPrompt();
      return null;
    }
    return prompt;
  } catch {
    clearPendingQuickStartPrompt();
    return null;
  }
}

export function syncPendingQuickStartFromNavigationState(state: unknown): void {
  const prompt = pendingQuickStartFromNavigationState(state);
  if (!prompt) return;
  writePendingQuickStartPrompt(prompt);
}

export function clearPendingQuickStartPrompt(): void {
  if (!hasSessionStorage()) return;
  window.sessionStorage.removeItem(PENDING_QUICK_START_STORAGE_KEY);
}

export function claimPendingQuickStartPrompt(): PendingQuickStartPrompt | null {
  const prompt = readPendingQuickStartPrompt();
  if (!prompt || isClaimFresh(prompt)) return null;
  const claimedPrompt = { ...prompt, claimedAt: Date.now() };
  writePendingQuickStartPrompt(claimedPrompt);
  return claimedPrompt;
}

export function releasePendingQuickStartPrompt(
  prompt: PendingQuickStartPrompt,
): void {
  const current = readPendingQuickStartPrompt();
  if (!current || current.id !== prompt.id) return;
  writePendingQuickStartPrompt({ ...current, claimedAt: undefined });
}

export function usePendingQuickStartRun(
  authStatus: AuthStatus,
  navigationState?: unknown,
): PendingQuickStartRunState {
  const navigate = useNavigate();
  const startedRef = useRef(false);
  const [state, setState] = useState<PendingQuickStartRunState>(() => ({
    hasPending: Boolean(
      pendingQuickStartFromNavigationState(navigationState) ??
        readPendingQuickStartPrompt(),
    ),
    starting: false,
    error: null,
  }));

  useEffect(() => {
    syncPendingQuickStartFromNavigationState(navigationState);
    setState((current) => ({
      ...current,
      hasPending: Boolean(readPendingQuickStartPrompt()),
    }));
  }, [navigationState]);

  useEffect(() => {
    if (authStatus !== "authenticated" || startedRef.current) return;

    const prompt = claimPendingQuickStartPrompt();
    if (!prompt) {
      setState((current) => ({
        ...current,
        hasPending: Boolean(readPendingQuickStartPrompt()),
      }));
      return;
    }

    startedRef.current = true;
    setState({ hasPending: true, starting: true, error: null });

    void startQuickStartRun(prompt)
      .then((result) => {
        clearPendingQuickStartPrompt();
        navigate(runProgressPath(result), { replace: true });
      })
      .catch((error) => {
        releasePendingQuickStartPrompt(prompt);
        startedRef.current = false;
        setState({
          hasPending: true,
          starting: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, [authStatus, navigate]);

  return state;
}
