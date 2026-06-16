import { Link } from "react-router-dom";
import type { DashboardCounts } from "@popcorn/shared/v1/dashboard";
import styles from "./OverviewStats.module.css";

const TILES: { key: keyof DashboardCounts; label: string; to: string }[] = [
  { key: "projects", label: "Projects", to: "/library/projects" },
  { key: "activeRuns", label: "Active runs", to: "/library/runs" },
  { key: "outputs", label: "Outputs", to: "/library/outputs" },
];

export function OverviewStats({ counts }: { counts: DashboardCounts }) {
  return (
    <section className={styles.grid} aria-label="Workspace overview">
      {TILES.map((tile) => (
        <Link key={tile.key} className={styles.tile} to={tile.to}>
          <span className={styles.value}>{counts[tile.key]}</span>
          <span className={styles.label}>{tile.label}</span>
        </Link>
      ))}
    </section>
  );
}
