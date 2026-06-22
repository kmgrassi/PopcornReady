import type {
  ProjectStoryboard,
  StoryboardItemStatus,
  StoryboardPanel,
} from "@popcorn/shared/v1/types";

export interface StoryboardProgress {
  /** Total panels the storyboard expects to render. */
  total: number;
  /** Panels with a finished image. */
  ready: number;
  /** Panels that failed to render. */
  failed: number;
  /** Panels still queued or actively rendering. */
  pending: number;
  /** 0–100 completion across all terminal (ready or failed) panels. */
  percent: number;
  /**
   * Whether the storyboard is still being produced — either the storyboard
   * itself reports `generating` or any panel is queued/generating. This is the
   * authoritative "keep showing a loading indicator" signal and survives a page
   * reload because it is derived purely from server state.
   */
  isGenerating: boolean;
}

const PENDING_PANEL_STATUSES: ReadonlySet<StoryboardItemStatus> = new Set([
  "queued",
  "generating",
]);

function allPanels(storyboard: ProjectStoryboard): StoryboardPanel[] {
  return storyboard.scenes.flatMap((scene) =>
    scene.beats.flatMap((beat) => beat.panels),
  );
}

export function storyboardProgress(
  storyboard: ProjectStoryboard | null,
): StoryboardProgress {
  if (!storyboard) {
    return { total: 0, ready: 0, failed: 0, pending: 0, percent: 0, isGenerating: false };
  }

  const panels = allPanels(storyboard);
  let ready = 0;
  let failed = 0;
  let pending = 0;
  for (const panel of panels) {
    if (panel.status === "ready" || panel.status === "approved") ready += 1;
    else if (panel.status === "failed" || panel.status === "rejected") failed += 1;
    else if (PENDING_PANEL_STATUSES.has(panel.status)) pending += 1;
  }

  const total = panels.length;
  const settled = ready + failed;
  const percent = total === 0 ? 0 : Math.round((settled / total) * 100);
  const isGenerating = storyboard.status === "generating" || pending > 0;

  return { total, ready, failed, pending, percent, isGenerating };
}
