import { Clip, Timeline, TimelineSegment } from "@popcorn/shared/types";

function newId(): string {
  return "seg_" + Math.random().toString(36).slice(2, 10);
}

// Clamp a segment's in/out points to the real clip duration and guarantee a
// minimum visible length. The agent is instructed to stay in bounds, but we
// never trust it — invalid timings would break rendering.
function clampSegment(
  seg: TimelineSegment,
  clipsById: Record<string, Clip>
): TimelineSegment | null {
  const clip = clipsById[seg.clipId];
  if (!clip) return null;
  const dur = clip.durationSec || 0;
  let inSec = Math.max(0, Math.min(seg.sourceInSec, Math.max(0, dur - 0.1)));
  let outSec = Math.min(dur || seg.sourceOutSec, seg.sourceOutSec);
  if (outSec - inSec < 0.3) {
    outSec = Math.min(dur || inSec + 1, inSec + 1);
  }
  if (outSec <= inSec) return null;
  return { ...seg, sourceInSec: inSec, sourceOutSec: outSec };
}

export function sanitizeTimeline(
  timeline: Timeline,
  clips: Clip[]
): Timeline {
  const byId = Object.fromEntries(clips.map((c) => [c.id, c]));
  const segments = timeline.segments
    .map((s) => clampSegment({ ...s, id: s.id || newId() }, byId))
    .filter((s): s is TimelineSegment => s !== null);
  return { ...timeline, segments };
}

// Compact representation of clips passed to the agents. Keeping it small and
// deterministic protects the prompt cache.
export function clipCatalog(clips: Clip[]): string {
  const visualClips = clips.filter((c) => (c.kind || "video") !== "audio");
  if (visualClips.length === 0) return "(no visual clips uploaded)";
  return visualClips
    .map(
      (c) =>
        `- id=${c.id} | kind=${c.kind || "video"} | source=${
          c.source || "upload"
        } | duration=${c.durationSec.toFixed(1)}s | file="${c.filename}" | description="${
          c.description || "n/a"
        }"`
    )
    .join("\n");
}

export function timelineForPrompt(timeline: Timeline, clips: Clip[]): string {
  const byId = Object.fromEntries(clips.map((c) => [c.id, c]));
  return timeline.segments
    .map((s, i) => {
      const c = byId[s.clipId];
      return `${i + 1}. segmentId=${s.id} | clipId=${s.clipId} (${
        c ? c.filename : "MISSING"
      }) | in=${s.sourceInSec.toFixed(1)}s out=${s.sourceOutSec.toFixed(
        1
      )}s | role=${s.role}${s.caption ? ` | caption="${s.caption}"` : ""}`;
    })
    .join("\n");
}
