import { Link, Navigate, useParams } from "react-router-dom";
import { ErrorState } from "../components/ui/StateCard";
import { ProjectView, formatDate } from "../components/project/ProjectView";
import { usePublicProjectQuery } from "../lib/project-queries";
import styles from "./ProjectDetailPage.module.css";

// Public, no-login read-only view of a shared project. Reuses the same
// presentational components as the authenticated project page.
export function PublicProjectPage() {
  const { projectId } = useParams();
  const query = usePublicProjectQuery(projectId ?? null);

  if (!projectId) return <Navigate to="/" replace />;

  const data = query.data ?? null;
  const project = data?.project ?? null;

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <Link className={styles.backLink} to="/">
            Popcorn Ready
          </Link>
          <h1>{project?.name ?? "Shared project"}</h1>
          <p>
            {project
              ? `Updated ${formatDate(project.updatedAt)}`
              : "Loading the shared project."}
          </p>
        </div>
      </header>

      {query.isLoading ? (
        <p className={styles.placeholder}>Loading project...</p>
      ) : null}

      {!query.isLoading && query.error ? (
        <ErrorState
          title="Project unavailable"
          body="This project is private or no longer exists."
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {!query.isLoading && !query.error && project && data ? (
        <ProjectView project={project} storyboard={data.storyboard} media={data.media} />
      ) : null}
    </main>
  );
}
