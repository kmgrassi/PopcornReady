import { useEffect, useState } from "react";

/**
 * AgentRunPreview — a self-contained, looping animation of a run that makes the
 * division of labor explicit: the *user* types one short brief into an input,
 * then the *agent* takes over and does everything else (plan beats, keyframes,
 * timeline). A "Stop here" control travels with the active agent stage to show
 * the human can step in at any step while the agent runs autonomously.
 *
 * It is purely decorative product theatre (no real generation), so it derives
 * every frame from a single tick counter — easy to reason about, resets
 * cleanly, and tears down on unmount. Honors prefers-reduced-motion by
 * rendering the finished state with no interval.
 */

const BRIEF = "A movie-loving kid discovers Popcorn Ready and wins Best Picture.";

const BEATS = [
  { tag: "HOOK", text: "Late-night editor drowns in a tangled timeline." },
  { tag: "BEAT", text: "Discovers Popcorn Ready — the agent takes the wheel." },
  { tag: "BEAT", text: "Idea to finished cut in one rising montage." },
  { tag: "PAYOFF", text: "Best Picture: “I’d like to thank Popcorn Ready.”" },
];

const TILE_COUNT = 5;

// Cadence, in ticks (1 tick = TICK_MS). Tuned so the full cycle reads in ~16s.
const TICK_MS = 90;
const TYPE_TICKS = 32; // user types the brief
const HANDOFF_TICKS = 8; // brief locks, agent takes over
const TICKS_PER_BEAT = 16;
const PLAN_TICKS = BEATS.length * TICKS_PER_BEAT;
const KEYFRAME_TICKS = 26;
const TIMELINE_TICKS = 24;
const HOLD_TICKS = 26;

// Phase boundaries (cumulative tick offsets within one cycle).
const T_HANDOFF = TYPE_TICKS;
const T_PLAN = T_HANDOFF + HANDOFF_TICKS;
const T_KEYFRAMES = T_PLAN + PLAN_TICKS;
const T_TIMELINE = T_KEYFRAMES + KEYFRAME_TICKS;
const T_READY = T_TIMELINE + TIMELINE_TICKS;
const CYCLE = T_READY + HOLD_TICKS;

type Phase = "typing" | "handoff" | "planning" | "keyframes" | "timeline" | "ready";
type Actor = "you" | "agent" | "done";
type Stage = "plan" | "keyframes" | "timeline" | null;

const PHASE_STATUS: Record<Phase, string> = {
  typing: "You · writing the brief",
  handoff: "Handing to the agent",
  planning: "Agent · planning beats",
  keyframes: "Agent · generating keyframes",
  timeline: "Agent · assembling timeline",
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
  actor: Actor;
  brief: string;
  briefTyping: boolean;
  submitted: boolean;
  beats: { tag: string; text: string; typing: boolean }[];
  tiles: number;
  timelinePct: number;
  activeStage: Stage;
}

const FINAL_FRAME: Frame = {
  phase: "ready",
  actor: "done",
  brief: BRIEF,
  briefTyping: false,
  submitted: true,
  beats: BEATS.map((beat) => ({ ...beat, typing: false })),
  tiles: TILE_COUNT,
  timelinePct: 100,
  activeStage: null,
};

function computeFrame(tick: number): Frame {
  const t = tick % CYCLE;

  // --- User types the brief ---------------------------------------
  let brief = BRIEF;
  let briefTyping = false;
  if (t < T_HANDOFF) {
    const fraction = Math.min(1, t / (TYPE_TICKS - 4));
    brief = BRIEF.slice(0, Math.round(BRIEF.length * fraction));
    briefTyping = fraction < 1;
  }
  const submitted = t >= T_HANDOFF;

  // --- Phase / actor ----------------------------------------------
  let phase: Phase;
  let actor: Actor;
  if (t < T_HANDOFF) {
    phase = "typing";
    actor = "you";
  } else if (t < T_PLAN) {
    phase = "handoff";
    actor = "agent";
  } else if (t < T_KEYFRAMES) {
    phase = "planning";
    actor = "agent";
  } else if (t < T_TIMELINE) {
    phase = "keyframes";
    actor = "agent";
  } else if (t < T_READY) {
    phase = "timeline";
    actor = "agent";
  } else {
    phase = "ready";
    actor = "done";
  }

  // --- Agent: plan beats stream in --------------------------------
  const planLocal = t - T_PLAN;
  const beats = BEATS.map((beat, index) => {
    if (t >= T_KEYFRAMES) return { ...beat, typing: false };
    const local = planLocal - index * TICKS_PER_BEAT;
    if (local <= 0) return null;
    const fraction = Math.min(1, local / (TICKS_PER_BEAT - 3));
    return {
      tag: beat.tag,
      text: beat.text.slice(0, Math.round(beat.text.length * fraction)),
      typing: fraction < 1,
    };
  }).filter(Boolean) as Frame["beats"];

  // --- Agent: keyframes pop, then timeline assembles --------------
  let tiles = 0;
  let timelinePct = 0;
  if (t >= T_KEYFRAMES) {
    const kf = t - T_KEYFRAMES;
    tiles = Math.min(TILE_COUNT, Math.floor(kf / (KEYFRAME_TICKS / TILE_COUNT)) + 1);
  }
  if (t >= T_TIMELINE) {
    tiles = TILE_COUNT;
    timelinePct = Math.min(100, ((t - T_TIMELINE) / TIMELINE_TICKS) * 100);
  }
  if (t >= T_READY) {
    tiles = TILE_COUNT;
    timelinePct = 100;
  }

  const activeStage: Stage =
    phase === "planning"
      ? "plan"
      : phase === "keyframes"
        ? "keyframes"
        : phase === "timeline"
          ? "timeline"
          : null;

  return {
    phase,
    actor,
    brief,
    briefTyping,
    submitted,
    beats,
    tiles,
    timelinePct,
    activeStage,
  };
}

function StepHead({ label, active }: { label: string; active: boolean }) {
  return (
    <span className="lp-run-step-head">
      <span className="lp-run-section-label">{label}</span>
      {active && (
        <span className="lp-run-stop">
          <span className="lp-run-stop-glyph" aria-hidden="true" />
          Stop here
        </span>
      )}
    </span>
  );
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
  const agentRunning = frame.actor === "agent";

  return (
    <div
      className="lp-run"
      role="img"
      aria-label="Preview of a run: you type one short brief, then the agent autonomously plans the beats, generates keyframes, and assembles the timeline — and you can stop it at any step."
    >
      <div className="lp-run-head">
        <span className={`lp-run-dot lp-run-dot-${frame.actor}`} aria-hidden="true" />
        <span className="lp-run-file">dream-montage.run</span>
        <span className={`lp-run-status lp-run-status-${frame.phase}`}>
          {PHASE_STATUS[frame.phase]}
          {frame.phase !== "ready" && (
            <span className="lp-run-ellipsis" aria-hidden="true" />
          )}
        </span>
      </div>

      {/* Step 1 — the human types one brief */}
      <div className="lp-run-prompt" aria-hidden="true">
        <span className="lp-run-actor lp-run-actor-you">You</span>
        <div className={`lp-run-input${frame.briefTyping ? " is-typing" : ""}`}>
          <span className="lp-run-input-text">{frame.brief}</span>
          {frame.briefTyping && <span className="lp-run-caret lp-run-caret-user" />}
        </div>
        <span className={`lp-run-generate${frame.submitted ? " is-active" : ""}`}>
          Generate
        </span>
      </div>

      {/* Hand-off — the agent now runs everything */}
      <div className="lp-run-handoff" aria-hidden="true">
        <span className="lp-run-handoff-arrow" />
        <span
          className={`lp-run-actor lp-run-actor-agent${agentRunning ? " is-live" : ""}`}
        >
          Agent
        </span>
        <span className="lp-run-handoff-note">
          {frame.phase === "ready"
            ? "Run complete"
            : "Running autonomously — step in at any step"}
        </span>
      </div>

      <div className="lp-run-body">
        <section className="lp-run-plan" aria-hidden="true">
          <StepHead label="Plan" active={frame.activeStage === "plan"} />
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
          <StepHead label="Keyframes" active={frame.activeStage === "keyframes"} />
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
        <StepHead label="Timeline" active={frame.activeStage === "timeline"} />
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
