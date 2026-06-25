import type { NextAction } from "../../lib/nextAction";
import { HeroCard } from "./HeroCard";
import styles from "./EmptyDashboard.module.css";

const previewSteps = [
  {
    title: "Brief",
    body: "Start with the idea, audience, tone, and the footage or references you already have.",
    meta: "You describe the goal",
  },
  {
    title: "Footage",
    body: "The studio turns the brief into structured scenes, assets, and runs you can inspect.",
    meta: "The agent assembles the cut",
  },
  {
    title: "Review",
    body: "Watch the result, then ask for changes to a scene, shot, or asset instead of editing every detail by hand.",
    meta: "You approve or request changes",
  },
];

export function EmptyDashboard({ action }: { action: NextAction }) {
  return (
    <div className={styles.section}>
      <HeroCard action={action} />

      <section className={styles.preview} aria-labelledby="first-run-title">
        <div className={styles.header}>
          <div>
            <h2 id="first-run-title">Your first run becomes a reviewable movie workspace.</h2>
            <p className={styles.hint}>
              Popcorn Ready handles the production path, then gives you clear
              checkpoints to review and steer.
            </p>
          </div>
        </div>

        <div className={styles.grid} aria-label="First-run workflow preview">
          {previewSteps.map((step) => (
            <article className={styles.card} key={step.title}>
              <span className={styles.cardMeta}>{step.meta}</span>
              <h3 className={styles.cardTitle}>{step.title}</h3>
              <p className={styles.cardBody}>{step.body}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
