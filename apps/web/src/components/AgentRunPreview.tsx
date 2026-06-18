import { useEffect, useState } from "react";
import styles from "./AgentRunPreview.module.css";

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

const DOT_CLASS: Record<Actor, string> = {
  you: styles.dotYou,
  agent: styles.dotAgent,
  done: styles.dotDone,
};

// Only user-turn + ready phases get a tinted status pill; agent phases keep
// the base amber pill (no extra class).
const STATUS_CLASS: Partial<Record<Phase, string>> = {
  typing: styles.statusTyping,
  handoff: styles.statusHandoff,
  ready: styles.statusReady,
};

function StepHead({ label, active }: { label: string; active: boolean }) {
  return (
    <span className={styles.stepHead}>
      <span className={styles.sectionLabel}>{label}</span>
      {active && (
        <span className={styles.stop}>
          <span className={styles.stopGlyph} aria-hidden="true" />
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
      className={styles.run}
      role="img"
      aria-label="Preview of a run: you type one short brief, then the agent autonomously plans the beats, generates keyframes, and assembles the timeline — and you can stop it at any step."
    >
      <div className={styles.head}>
        <span className={`${styles.dot} ${DOT_CLASS[frame.actor]}`} aria-hidden="true" />
        <span className={styles.file}>dream-montage.run</span>
        <span className={`${styles.status}${STATUS_CLASS[frame.phase] ? ` ${STATUS_CLASS[frame.phase]}` : ""}`}>
          {PHASE_STATUS[frame.phase]}
          {frame.phase !== "ready" && (
            <span className={styles.ellipsis} aria-hidden="true" />
          )}
        </span>
      </div>

      {/* Step 1 — the human types one brief */}
      <div className={styles.prompt} aria-hidden="true">
        <span className={`${styles.actor} ${styles.actorYou}`}>You</span>
        <div className={`${styles.input}${frame.briefTyping ? ` ${styles.inputTyping}` : ""}`}>
          <span className={styles.inputText}>{frame.brief}</span>
          {frame.briefTyping && <span className={`${styles.caret} ${styles.caretUser}`} />}
        </div>
        <span className={`${styles.generate}${frame.submitted ? ` ${styles.generateActive}` : ""}`}>
          Generate
        </span>
      </div>

      {/* Hand-off — the agent now runs everything */}
      <div className={styles.handoff} aria-hidden="true">
        <span className={styles.handoffArrow} />
        <span
          className={`${styles.actor} ${styles.actorAgent}${agentRunning ? ` ${styles.live}` : ""}`}
        >
          Agent
        </span>
        <span className={styles.handoffNote}>
          {frame.phase === "ready"
            ? "Run complete"
            : "Running autonomously — step in at any step"}
        </span>
      </div>

      <div className={styles.body}>
        <section aria-hidden="true">
          <StepHead label="Plan" active={frame.activeStage === "plan"} />
          <ul className={styles.beats}>
            {frame.beats.map((beat, index) => (
              <li className={styles.beat} key={index}>
                <span className={styles.beatTag}>{beat.tag}</span>
                <span className={styles.beatText}>
                  {beat.text}
                  {beat.typing && <span className={styles.caret} />}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-hidden="true">
          <StepHead label="Keyframes" active={frame.activeStage === "keyframes"} />
          <div className={styles.tiles}>
            {Array.from({ length: TILE_COUNT }, (_, index) => (
              <span
                className={`${styles.tile}${index < frame.tiles ? ` ${styles.tileReady}` : ""}`}
                data-tile={index}
                key={index}
              />
            ))}
          </div>
        </section>
      </div>

      <section className={styles.timeline} aria-hidden="true">
        <StepHead label="Timeline" active={frame.activeStage === "timeline"} />
        <div className={styles.track}>
          {BEATS.map((_, index) => {
            const segStart = (index / BEATS.length) * 100;
            const filled = frame.timelinePct > segStart;
            return (
              <span
                className={`${styles.seg}${filled ? ` ${styles.segFilled}` : ""}`}
                key={index}
              />
            );
          })}
          <span
            className={styles.playhead}
            style={{ left: `${frame.timelinePct}%` }}
          />
        </div>
      </section>
    </div>
  );
}
