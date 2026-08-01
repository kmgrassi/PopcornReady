import type { NextAction } from "../../lib/nextAction";
import { HeroCard } from "./HeroCard";
import styles from "./EmptyDashboard.module.css";

const previewSteps = [
  {
    title: "Choose",
    body: "Pick an image, short video, or audio asset and connect it to the project that needs it.",
    meta: "Start with the format",
  },
  {
    title: "Describe",
    body: "Tell the studio what the result should feel like in plain creative language.",
    meta: "Set the direction",
  },
  {
    title: "Review",
    body: "Check the exact request and cost boundary before generation begins.",
    meta: "Stay in control",
  },
];

export function EmptyDashboard({ action }: { action: NextAction }) {
  return (
    <div className={styles.section}>
      <HeroCard action={action} />

      <section className={styles.preview} aria-labelledby="first-run-title">
        <div className={styles.header}>
          <div>
            <h2 id="first-run-title">Every creation stays connected to its project.</h2>
            <p className={styles.hint}>
              Start with one useful project asset, review the request, and let
              Popcorn Ready keep the work and its provenance together.
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
