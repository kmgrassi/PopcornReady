import { LandingSection } from "./LandingSection";
import styles from "./WorkflowStages.module.css";

// The five stages the agent crew runs. Copy is AI-first: every stage is
// something the creative director and its specialists *do* on your direction —
// never a manual editing step. The stages are presented as a loop, not a
// one-way chain, because any stage can be re-run and only the affected assets
// recompute (see docs/NORTH_STAR.md).
const STAGES = [
  {
    name: "Plan",
    body: "The creative director turns your idea into a structured plan — scenes, beats, shots, timing, and continuity rules — before anything is generated.",
  },
  {
    name: "Generate",
    body: "The director hands each beat to specialist agents: the visuals specialist generates keyframes and Gemini Veo clips, the audio specialist produces ElevenLabs voice and music. Regenerate a single shot without starting over.",
  },
  {
    name: "Edit",
    body: "Edits happen on the structured timeline, by the director — tighten pacing, swap a weak shot, fix continuity. You direct; it revises.",
  },
  {
    name: "Review",
    body: "An AI critic checks visual consistency, narrative clarity, pacing, and missing scenes, then proposes targeted fixes.",
  },
  {
    name: "Publish",
    body: "Deterministic export to vertical, square, or widescreen via Remotion. The agents only edit structured data; rendering never touches raw video.",
  },
];

export function WorkflowStages() {
  return (
    <LandingSection
      id="workflow"
      title="The production workflow"
      subtitle="You direct; the agent crew does the work — a creative director plans, delegates generation to visuals and audio specialists, reviews, and publishes. It runs autonomously, and you step in at any point."
    >
      <ol className={styles.stages}>
        {STAGES.map((stage) => (
          <li className={styles.stage} key={stage.name}>
            <h3 className={styles.name}>{stage.name}</h3>
            <p className={styles.body}>{stage.body}</p>
          </li>
        ))}
      </ol>

      <p className={styles.loop}>
        <span className={styles.loopIcon} aria-hidden="true">
          ↺
        </span>
        Not a one-way pipeline: the director can re-enter any stage. Change one
        thing and only the affected shots recompute.
      </p>
    </LandingSection>
  );
}
