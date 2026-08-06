import type { MediaIntentPresetId } from "./project-media-intent";

const PROJECT_MEDIA_DRAFT_PREFIX = "popcornready:project-media-draft:v1:";

type DraftStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export interface ProjectMediaDraft {
  selectedIds: string[];
  selectedPresetId: MediaIntentPresetId | "";
  intentText: string;
}

function draftStorage(): DraftStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function projectMediaDraftKey(projectId: string): string {
  return `${PROJECT_MEDIA_DRAFT_PREFIX}${encodeURIComponent(projectId)}`;
}

function isPresetId(value: unknown): value is MediaIntentPresetId | "" {
  return value === "" || value === "montage" || value === "trailer" || value === "narration";
}

export function readProjectMediaDraft(
  projectId: string,
  storage: DraftStorage | null = draftStorage(),
): ProjectMediaDraft | null {
  if (!projectId || !storage) return null;
  const key = projectMediaDraftKey(projectId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProjectMediaDraft> & { version?: unknown };
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.selectedIds) ||
      !parsed.selectedIds.every((id) => typeof id === "string" && id.length > 0) ||
      !isPresetId(parsed.selectedPresetId) ||
      typeof parsed.intentText !== "string"
    ) {
      storage.removeItem(key);
      return null;
    }
    return {
      selectedIds: [...new Set(parsed.selectedIds)],
      selectedPresetId: parsed.selectedPresetId,
      intentText: parsed.intentText,
    };
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Storage can be unavailable in hardened/private browser contexts.
    }
    return null;
  }
}

export function stashProjectMediaDraft(
  projectId: string,
  draft: ProjectMediaDraft,
  storage: DraftStorage | null = draftStorage(),
): void {
  if (!projectId || !storage) return;
  const key = projectMediaDraftKey(projectId);
  try {
    if (
      draft.selectedIds.length === 0 &&
      draft.selectedPresetId === "" &&
      draft.intentText === ""
    ) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify({ version: 1, ...draft }));
  } catch {
    // Draft persistence is best-effort and must not block preview navigation.
  }
}

export function clearProjectMediaDraft(
  projectId: string,
  storage: DraftStorage | null = draftStorage(),
): void {
  if (!projectId || !storage) return;
  try {
    storage.removeItem(projectMediaDraftKey(projectId));
  } catch {
    // Draft cleanup is best-effort.
  }
}
