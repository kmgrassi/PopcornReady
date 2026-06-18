import { useEffect, useState } from "react";

/**
 * AgentRunPreview — a self-contained, looping animation of an agent run:
 * plan beats stream in with a typewriter, keyframes pop, then the timeline
 * assembles. It is purely decorative product theatre (no real generation), so
 * it derives every frame from a single tick counter — easy to reason about,
 * resets cleanly, and tears down on unmount. Honors prefers-reduced-motion by
 * rendering the finished state with no interval.
 */

const BEATS = [
  { tag: "HOOK", text: "Late-night editor drowns in a tangled timeline." },
  { tag: "BEAT", text: "Discovers Popcorn Ready — the agent takes the wheel." },
  { tag: "BEAT", text: "Idea to finished cut in one rising montage." },
  { tag: "PAYOFF", text: "Best Picture: “I’d like to thank Popcorn Ready.”" },
];

const TILE_COUNT = 5;

// Cadence, in ticks (1 tick = TICK_MS). Tuned so the full cycle reads in ~14s.
const TICK_MS = 90;
const TICKS_PER_BEAT = 18;
const PLAN_TICKS = BEATS.length * TICKS_PER_BEAT;
const KEYFRAME_TICKS = 30;
const TIMELINE_TICKS = 28;
const HOLD_TICKS = 26;
const CYCLE = PLAN_TICKS + KEYFRAME_TICKS + TIMELINE_TICKS + HOLD_TICKS;

type Phase = "planning" | "keyframes" | "timeline" | "ready";

const PHASE_LABEL: Record<Phase, string> = {
  planning: "Planning beats",
  keyframes: "Generating keyframes",
  timeline: "Assembling timeline",
  ready: "Render ready",
};

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

interface Frame {
  phase: Phase;
  beats: { tag: string; text: string; typing: boolean }[];
  tiles: number;
  timelinePct: number;
}

const FINAL_FRAME: Frame = {
  phase: "ready",
  beats: BEATS.map((beat) => ({ ...beat, typing: false })),
  tiles: TILE_COUNT,
  timelinePct: 100,
};

function computeFrame(tick: number): Frame {
  const t = tick % CYCLE;

  // Plan beats: each beat types over TICKS_PER_BEAT, slightly front-loaded so
  // the caret lands before the next beat starts.
  const beats = BEATS.map((beat, index) => {
    const local = t - index * TICKS_PER_BEAT;
    if (t >= PLAN_TICKS) return { ...beat, typing: false };
    if (local <= 0) return null;
    const fraction = Math.min(1, local / (TICKS_PER_BEAT - 3));
    const shown = Math.round(beat.text.length * fraction);
    return {
      tag: beat.tag,
      text: beat.text.slice(0, shown),
      typing: fraction < 1,
    };
  }).filter(Boolean) as Frame["beats"];

  let phase: Phase = "planning";
  let tiles = 0;
  let timelinePct = 0;

  if (t >= PLAN_TICKS) {
    const kf = t - PLAN_TICKS;
    tiles = Math.min(TILE_COUNT, Math.floor(kf / (KEYFRAME_TICKS / TILE_COUNT)) + 1);
    phase = "keyframes";
  }
  if (t >= PLAN_TICKS + KEYFRAME_TICKS) {
    const tl = t - PLAN_TICKS - KEYFRAME_TICKS;
    tiles = TILE_COUNT;
    timelinePct = Math.min(100, (tl / TIMELINE_TICKS) * 100);
    phase = "timeline";
  }
  if (t >= PLAN_TICKS + KEYFRAME_TICKS + TIMELINE_TICKS) {
    tiles = TILE_COUNT;
    timelinePct = 100;
    phase = "ready";
  }

  return { phase, beats, tiles, timelinePct };
}

export function AgentRunPreview() {
  const [tick, setTick] = useState(0);
  const [reduced] = useState(prefersReducedMotion);

  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => setTick((value) => value + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, [reduced]);

  const frame = reduced ? FINAL_FRAME : computeFrame(tick);

  return (
    <div className="lp-run" role="img" aria-label="Live preview of an agent run: planning beats, generating keyframes, and assembling the timeline.">
      <div className="lp-run-head">
        <span className="lp-run-dot" aria-hidden="true" />
        <span className="lp-run-file">dream-montage.run</span>
        <span className={`lp-run-status lp-run-status-${frame.phase}`}>
          {PHASE_LABEL[frame.phase]}
          {frame.phase !== "ready" && <span className="lp-run-ellipsis" aria-hidden="true" />}
        </span>
      </div>

      <div className="lp-run-body">
        <section className="lp-run-plan" aria-hidden="true">
          <span className="lp-run-section-label">Plan</span>
          <ul className="lp-run-beats">
            {frame.beats.map((beat, index) => (
              <li className="lp-run-beat" key={index}>
                <span className="lp-run-beat-tag">{beat.tag}</span>
                <span className="lp-run-beat-text">
                  {beat.text}
                  {beat.typing && <span className="lp-run-caret" />}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="lp-run-assets" aria-hidden="true">
          <span className="lp-run-section-label">Keyframes</span>
          <div className="lp-run-tiles">
            {Array.from({ length: TILE_COUNT }, (_, index) => (
              <span
                className={`lp-run-tile${index < frame.tiles ? " is-ready" : ""}`}
                data-tile={index}
                key={index}
              />
            ))}
          </div>
        </section>
      </div>

      <section className="lp-run-timeline" aria-hidden="true">
        <span className="lp-run-section-label">Timeline</span>
        <div className="lp-run-track">
          {BEATS.map((_, index) => {
            const segStart = (index / BEATS.length) * 100;
            const filled = frame.timelinePct > segStart;
            return (
              <span
                className={`lp-run-seg${filled ? " is-filled" : ""}`}
                key={index}
              />
            );
          })}
          <span
            className="lp-run-playhead"
            style={{ left: `${frame.timelinePct}%` }}
          />
        </div>
      </section>
    </div>
  );
}
