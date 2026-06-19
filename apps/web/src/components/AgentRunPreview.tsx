import { useEffect, useState } from "react";
import styles from "./AgentRunPreview.module.css";

/**
 * AgentRunPreview — a self-contained, looping animation of a run, staged so the
 * viewer reads one idea at a time instead of a single cluttered dump:
 *
 *   1. You type one short brief, the agent takes over.
 *   2. ACT ONE — PLAN: the agent writes the plan (hook + steps), shown large and
 *      on its own.
 *   3. A tiny "Want to continue on?" indicator counts 3 · 2 · 1.
 *   4. ACT TWO — PRODUCE: the plan demotes to a compact recap and the keyframes
 *      + timeline take over, now the prominent thing on screen.
 *
 * Purely decorative product theatre (no real generation): every frame derives
 * from a single tick counter, so it resets cleanly and tears down on unmount.
 * Honors prefers-reduced-motion by rendering the finished state with no interval.
 */

const BRIEF = "A movie-loving kid discovers Popcorn Ready and wins Best Picture.";

const BEATS = [
  { tag: "HOOK", text: "A boy drowns in a tangled timeline, late at night." },
  { tag: "BEAT", text: "Discovers Popcorn Ready — the boy takes the wheel." },
  { tag: "BEAT", text: "Idea to finished cut in one rising montage." },
  { tag: "PAYOFF", text: "Best Picture: “I’d like to thank Popcorn Ready.”" },
];

const TILE_COUNT = 5;

// Storyboard keyframes, one per beat of the dream-montage.
const KEYFRAME_SRCS: (string | null)[] = [
  "/images/keyframe-1.jpg", // hook — the struggle
  "/images/keyframe-2.jpg", // discovery — the turn
  "/images/keyframe-3.jpg", // montage — momentum
  "/images/keyframe-4.jpg", // premiere — arrival
  "/images/keyframe-5.jpg", // payoff — best picture
];

// Cadence, in ticks (1 tick = TICK_MS). Tuned so the full cycle reads in ~20s.
const TICK_MS = 90;
const TYPE_TICKS = 30; // user types the brief
const HANDOFF_TICKS = 8; // brief locks, agent takes over
const TICKS_PER_BEAT = 14;
const PLAN_TICKS = BEATS.length * TICKS_PER_BEAT; // beats stream in
const PLAN_HOLD_TICKS = 12; // finished plan breathes before the prompt
const CONTINUE_LEAD_TICKS = 14; // "Want to continue on?"
const COUNT_TICKS = 9; // each of 3 · 2 · 1
const ACTION_TICKS = 10; // clapperboard snaps shut → "ACTION"
const CONTINUE_TICKS = CONTINUE_LEAD_TICKS + COUNT_TICKS * 3 + ACTION_TICKS;
const KEYFRAME_TICKS = 30;
const WRAP_TICKS = 36; // clapperboard snaps "CUT", holds, then the cycle loops

// Phase boundaries (cumulative tick offsets within one cycle).
const T_HANDOFF = TYPE_TICKS;
const T_PLAN = T_HANDOFF + HANDOFF_TICKS;
const T_PLAN_DONE = T_PLAN + PLAN_TICKS;
const T_CONTINUE = T_PLAN_DONE + PLAN_HOLD_TICKS;
const T_KEYFRAMES = T_CONTINUE + CONTINUE_TICKS;
const T_WRAP = T_KEYFRAMES + KEYFRAME_TICKS;
const CYCLE = T_WRAP + WRAP_TICKS;

type Phase =
  | "typing"
  | "handoff"
  | "planning"
  | "continue"
  | "keyframes"
  | "wrap";
type Actor = "you" | "agent" | "done";
type Act = "plan" | "produce";
type Stage = "plan" | "keyframes" | null;
type ClapState = "ask" | "count" | "action" | "cut" | null;

const PHASE_STATUS: Record<Phase, string> = {
  typing: "You · writing the brief",
  handoff: "Handing to the agent",
  planning: "Agent · writing the plan",
  continue: "Plan ready · continuing",
  keyframes: "Agent · generating keyframes",
  wrap: "Cut · take complete",
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
  act: Act;
  brief: string;
  briefTyping: boolean;
  submitted: boolean;
  beats: { tag: string; text: string; typing: boolean }[];
  countdown: number | null;
  clapState: ClapState;
  clapped: boolean;
  tiles: number;
  activeStage: Stage;
}

const FINAL_FRAME: Frame = {
  phase: "wrap",
  actor: "done",
  act: "produce",
  brief: BRIEF,
  briefTyping: false,
  submitted: true,
  beats: BEATS.map((beat) => ({ ...beat, typing: false })),
  countdown: null,
  clapState: "cut",
  clapped: true,
  tiles: TILE_COUNT,
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
  } else if (t < T_CONTINUE) {
    phase = "planning";
    actor = "agent";
  } else if (t < T_KEYFRAMES) {
    phase = "continue";
    actor = "agent";
  } else if (t < T_WRAP) {
    phase = "keyframes";
    actor = "agent";
  } else {
    phase = "wrap";
    actor = "done";
  }

  // Act one (plan) runs until the keyframes start; then act two (produce).
  const act: Act = t < T_KEYFRAMES ? "plan" : "produce";

  // --- Agent: plan beats stream in --------------------------------
  const planLocal = t - T_PLAN;
  const beats = BEATS.map((beat, index) => {
    if (t >= T_PLAN_DONE) return { ...beat, typing: false };
    const local = planLocal - index * TICKS_PER_BEAT;
    if (local <= 0) return null;
    const fraction = Math.min(1, local / (TICKS_PER_BEAT - 3));
    return {
      tag: beat.tag,
      text: beat.text.slice(0, Math.round(beat.text.length * fraction)),
      typing: fraction < 1,
    };
  }).filter(Boolean) as Frame["beats"];

  // --- The clapperboard: "CUT" → 3 · 2 · 1 → "ACTION" -------------
  let countdown: number | null = null;
  let clapState: ClapState = null;
  let clapped = false;
  if (phase === "continue") {
    const cl = t - T_CONTINUE;
    if (cl < CONTINUE_LEAD_TICKS) {
      clapState = "ask"; // slate reads "CUT", arm raised
    } else if (cl < CONTINUE_LEAD_TICKS + COUNT_TICKS * 3) {
      clapState = "count";
      countdown = Math.max(1, 3 - Math.floor((cl - CONTINUE_LEAD_TICKS) / COUNT_TICKS));
    } else {
      clapState = "action"; // arm snaps shut, slate reads "ACTION"
      clapped = true;
    }
  } else if (phase === "wrap") {
    clapState = "cut"; // the take is done — director calls "cut"
    clapped = true;
  }

  // --- Agent: keyframes pop in one by one -------------------------
  let tiles = 0;
  if (t >= T_KEYFRAMES) {
    const kf = t - T_KEYFRAMES;
    tiles = Math.min(TILE_COUNT, Math.floor(kf / (KEYFRAME_TICKS / TILE_COUNT)) + 1);
  }
  if (t >= T_WRAP) {
    tiles = TILE_COUNT;
  }

  const activeStage: Stage =
    phase === "planning"
      ? "plan"
      : phase === "keyframes"
        ? "keyframes"
        : null;

  return {
    phase,
    actor,
    act,
    brief,
    briefTyping,
    submitted,
    beats,
    countdown,
    clapState,
    clapped,
    tiles,
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
  wrap: styles.statusReady,
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
      aria-label="Preview of a run: you type one short brief, the agent writes the plan, then on your go-ahead it generates the keyframes and assembles the timeline — and you can stop it at any step."
    >
      <div className={styles.head}>
        <span className={`${styles.dot} ${DOT_CLASS[frame.actor]}`} aria-hidden="true" />
        <span className={styles.file}>dream-montage.run</span>
        <span className={`${styles.status}${STATUS_CLASS[frame.phase] ? ` ${STATUS_CLASS[frame.phase]}` : ""}`}>
          {PHASE_STATUS[frame.phase]}
          {frame.phase !== "wrap" && (
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

      {/* Hand-off — only after "Generate" is clicked (the brief is submitted);
          while the user is still typing there is no agent line yet. */}
      {frame.submitted && (
        <div className={styles.handoff} aria-hidden="true">
          <span className={styles.handoffArrow} />
          <span
            className={`${styles.actor} ${styles.actorAgent}${agentRunning ? ` ${styles.live}` : ""}`}
          >
            Agent
          </span>
          <span className={styles.handoffNote}>
            {frame.phase === "wrap"
              ? "That's a cut — run complete"
              : "Running autonomously — step in at any step"}
          </span>
        </div>
      )}

      {frame.act === "plan" ? (
        /* ACT ONE — the plan, large and on its own */
        <section className={styles.planStage} aria-hidden="true">
          <StepHead label="Plan" active={frame.activeStage === "plan"} />
          <div className={styles.planCard}>
            <ul className={styles.planList}>
              {frame.beats.map((beat, index) => (
                <li
                  className={beat.tag === "HOOK" ? styles.planHook : styles.planStep}
                  key={index}
                >
                  <span className={styles.beatTag}>{beat.tag}</span>
                  <span className={styles.beatText}>
                    {beat.text}
                    {beat.typing && <span className={styles.caret} />}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {frame.phase === "continue" && (
            <div className={styles.clapRow}>
              <div
                className={`${styles.clap}${frame.clapped ? ` ${styles.clapShut}` : ""}`}
                data-state={frame.clapState ?? undefined}
              >
                <span className={styles.clapStick} aria-hidden="true" />
                <span className={styles.clapBody}>
                  <span
                    className={styles.clapText}
                    key={`${frame.clapState}-${frame.countdown ?? ""}`}
                  >
                    {frame.clapState === "action"
                      ? "ACTION"
                      : frame.clapState === "count"
                        ? frame.countdown
                        : "CUT"}
                  </span>
                </span>
              </div>
              <span className={styles.clapCaption}>
                {frame.clapState === "action"
                  ? "Rolling — action!"
                  : frame.clapState === "count"
                    ? "Continuing the run…"
                    : "Want to continue on?"}
              </span>
            </div>
          )}
        </section>
      ) : (
        /* ACT TWO — plan recedes to a recap; keyframes + timeline take over */
        <section className={styles.produceStage} aria-hidden="true">
          <div className={styles.planRecap}>
            <span className={styles.sectionLabel}>Plan</span>
            <span className={styles.recapCheck} aria-hidden="true">
              ✓
            </span>
            <span className={styles.recapText}>{BEATS[0].text}</span>
            <span className={styles.recapCount}>+{BEATS.length - 1} beats</span>
          </div>

          <div className={styles.produceMain}>
            <div className={styles.keyframesCard}>
              <StepHead label="Keyframes" active={frame.activeStage === "keyframes"} />
              <div className={styles.tiles}>
                {Array.from({ length: TILE_COUNT }, (_, index) => {
                  const ready = index < frame.tiles;
                  const src = KEYFRAME_SRCS[index];
                  return (
                    <span
                      className={`${styles.tile}${ready ? ` ${styles.tileReady}` : ""}`}
                      data-tile={index}
                      key={index}
                    >
                      {ready && src && (
                        <img className={styles.tileImg} src={src} alt="" loading="lazy" />
                      )}
                    </span>
                  );
                })}
              </div>
            </div>

            {frame.phase === "wrap" && (
              <div className={styles.clapRow}>
                <div className={`${styles.clap} ${styles.clapShut}`} data-state="cut">
                  <span className={styles.clapStick} aria-hidden="true" />
                  <span className={styles.clapBody}>
                    <span className={styles.clapText}>CUT</span>
                  </span>
                </div>
                <span className={styles.clapCaption}>That&apos;s a cut.</span>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
