import type { DashboardCounts } from "@popcorn/shared/v1/dashboard";
import styles from "./OverviewStats.module.css";

export function OverviewStats({ counts }: { counts: DashboardCounts }) {
  return (
    <section className={styles.summary} aria-label="Workspace overview">
      <span className={styles.label}>Workspace at a glance</span>
      <p className={styles.counts}>
        <span>{formatCount(counts.projects, "project")}</span>
        <span>{formatCount(counts.activeRuns, "active run")}</span>
        <span>{formatCount(counts.outputs, "output")}</span>
      </p>
    </section>
  );
}

function formatCount(value: number, singular: string) {
  return `${value} ${singular}${value === 1 ? "" : "s"}`;
}
