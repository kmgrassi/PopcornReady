import { useState } from "react";
import type { V1Project } from "@popcorn/shared/v1/types";
import { ImageWithSkeleton } from "../../components/ui/ImageWithSkeleton";
import styles from "./RecentProjectSwitcher.module.css";

const RECENT_PROJECT_LIMIT = 4;

export function RecentProjectSwitcher({
  projects,
  selectedProjectId,
  loading,
  onSelect,
}: {
  projects: V1Project[];
  selectedProjectId: string;
  loading: boolean;
  onSelect: (projectId: string) => void;
}) {
  const recentProjects = projects
    .map((project, index) => ({
      project,
      index,
      updatedAt: Date.parse(project.updatedAt),
    }))
    .sort((left, right) => {
      const leftIsValid = Number.isFinite(left.updatedAt);
      const rightIsValid = Number.isFinite(right.updatedAt);
      if (leftIsValid && rightIsValid && left.updatedAt !== right.updatedAt) {
        return right.updatedAt - left.updatedAt;
      }
      if (leftIsValid !== rightIsValid) return leftIsValid ? -1 : 1;
      return left.index - right.index;
    })
    .slice(0, RECENT_PROJECT_LIMIT)
    .map(({ project }) => project);

  if (!loading && recentProjects.length === 0) return null;

  return (
    <nav className={styles.root} aria-label="Recent projects">
      <span className={styles.label}>Recent projects</span>
      <div className={styles.projects}>
        {loading && recentProjects.length === 0
          ? Array.from({ length: RECENT_PROJECT_LIMIT }, (_, index) => (
              <span
                key={index}
                className={styles.skeleton}
                aria-hidden="true"
              />
            ))
          : recentProjects.map((project) => (
              <RecentProjectButton
                key={project.id}
                project={project}
                selected={project.id === selectedProjectId}
                onSelect={onSelect}
              />
            ))}
      </div>
    </nav>
  );
}

function RecentProjectButton({
  project,
  selected,
  onSelect,
}: {
  project: V1Project;
  selected: boolean;
  onSelect: (projectId: string) => void;
}) {
  const [failedPoster, setFailedPoster] = useState(false);
  const posterUrl = failedPoster ? null : project.posterUrl;

  return (
    <button
      type="button"
      className={selected ? `${styles.project} ${styles.selected}` : styles.project}
      aria-pressed={selected}
      aria-label={`Use recent project ${project.name}`}
      title={project.name}
      onClick={() => onSelect(project.id)}
    >
      {posterUrl ? (
        <ImageWithSkeleton
          className={styles.poster}
          src={posterUrl}
          alt=""
          onError={() => setFailedPoster(true)}
        />
      ) : (
        <span className={styles.fallback} aria-hidden="true">
          {project.name.trim().charAt(0).toUpperCase() || "?"}
        </span>
      )}
      <span className={styles.name}>{project.name}</span>
    </button>
  );
}
