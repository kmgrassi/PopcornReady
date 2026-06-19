import styles from "./WorkflowStages.module.css";

// The five stages the agent runs. Copy is AI-first: every stage is something the
// agent *does* on your direction — never a manual editing step. The stages are
// presented as a loop, not a one-way chain, because any stage can be re-run and
// only the affected assets recompute (see docs/NORTH_STAR.md).
const STAGES = [
  {
    n: "01",
    name: "Plan",
    body: "The agent turns your idea into a structured plan — scenes, beats, shots, timing, and continuity rules — before anything is generated.",
  },
  {
    n: "02",
    name: "Generate",
    body: "It generates the shot for each beat: Veo or Sora video, keyframes, voiceover, captions. Regenerate a single shot without starting over.",
  },
  {
    n: "03",
    name: "Edit",
    body: "Edits happen on the structured timeline, by the agent — tighten pacing, swap a weak shot, fix continuity. You direct; it revises.",
  },
  {
    n: "04",
    name: "Review",
    body: "An AI critic checks visual consistency, narrative clarity, pacing, and missing scenes, then proposes targeted fixes.",
  },
  {
    n: "05",
    name: "Publish",
    body: "Deterministic export to vertical, square, or widescreen via Remotion. The agent only edits structured data; rendering never touches raw video.",
  },
];

export function WorkflowStages() {
  return (
    <section id="workflow" className="lp-section">
      <h2 className="lp-section-title">The production workflow</h2>
      <p className="lp-section-sub">
        You direct; the agent does the work — plan, generate, edit, review, and
        publish. It runs autonomously, and you step in at any point.
      </p>

      <ol className={styles.stages}>
        {STAGES.map((stage) => (
          <li className={styles.stage} key={stage.n}>
            <span className={styles.index}>{stage.n}</span>
            <h3 className={styles.name}>{stage.name}</h3>
            <p className={styles.body}>{stage.body}</p>
          </li>
        ))}
      </ol>

      <p className={styles.loop}>
        <span className={styles.loopIcon} aria-hidden="true">
          ↺
        </span>
        Not a one-way pipeline: the agent can re-enter any stage. Change one
        thing and only the affected shots recompute.
      </p>
    </section>
  );
}
