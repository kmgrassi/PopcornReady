import { Link } from "react-router-dom";
import type { NextAction } from "../../lib/nextAction";
import { HeroCard } from "./HeroCard";
import styles from "./EmptyDashboard.module.css";

// Concrete starting points for a brand-new workspace. Each prefills the studio
// brief via the `goal` param so the first run is one click away.
const QUICK_STARTS = [
  {
    title: "Product launch ad",
    goal: "A 30-second launch ad that hooks in the first three seconds, shows the product in use, and ends with a clear call to action.",
  },
  {
    title: "Founder story",
    goal: "A 60-second founder story that opens on the problem, shows the journey, and lands on the mission.",
  },
  {
    title: "Explainer reel",
    goal: "A short social explainer that breaks down how the product works in three simple steps.",
  },
];

export function EmptyDashboard({ action }: { action: NextAction }) {
  return (
    <>
      <HeroCard action={action} />

      <section className={styles.section} aria-labelledby="quick-start-title">
        <div className={styles.header}>
          <h2 id="quick-start-title">Start from an idea</h2>
          <span className={styles.hint}>Pick one to prefill the brief</span>
        </div>

        <div className={styles.grid}>
          {QUICK_STARTS.map((quickStart) => (
            <Link
              key={quickStart.title}
              className={styles.card}
              to={`/studio?${new URLSearchParams({ goal: quickStart.goal, start: "1" }).toString()}`}
            >
              <span className={styles.cardTitle}>{quickStart.title}</span>
              <span className={styles.cardBody}>{quickStart.goal}</span>
              <span className={styles.cardCta} aria-hidden="true">
                Use this idea &rarr;
              </span>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
