import { Link } from "react-router-dom";
import { useAuth } from "../components/auth/AuthProvider";
import { StudioCrewLoadingState } from "../components/creation/StudioCrewLoadingState";
import { ProjectUploadButton } from "../components/project-upload/ProjectUploadButton";
import { Button, ButtonLink } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { EmptyState, ErrorState } from "../components/ui/StateCard";
import { useDashboardProjectsQuery } from "../lib/v1/dashboard/query";
import { formatDate } from "./project-detail-format";
import styles from "./UploadsPage.module.css";

export function UploadsPage() {
  const auth = useAuth();
  const authScope = auth.user?.id ?? (import.meta.env.DEV ? "dev-autopilot" : auth.status);
  const projectsQuery = useDashboardProjectsQuery(authScope, 24, "mine");

  return (
    <main className={styles.page}>
      <PageHeader
        eyebrow="Uploads"
        title="Add source media"
        description="Choose a project, then add images, videos, or audio to its media library."
        action={
          <ButtonLink variant="primary" to="/projects/new">
            New project
          </ButtonLink>
        }
      />

      {projectsQuery.loading ? (
        <StudioCrewLoadingState
          title="Loading upload destinations"
          description="Gathering projects that can receive source media."
          reservation={(
            <div className={styles.grid}>
            {Array.from({ length: 4 }, (_, index) => (
              <div className={styles.skeleton} key={index} />
            ))}
            </div>
          )}
          variant="page"
        />
      ) : null}

      {!projectsQuery.loading && projectsQuery.error ? (
        <ErrorState
          title="Unable to load projects"
          body="We couldn't load the project list for uploads."
          error={projectsQuery.error}
          onRetry={projectsQuery.refetch}
        />
      ) : null}

      {!projectsQuery.loading && !projectsQuery.error && projectsQuery.items.length === 0 ? (
        <EmptyState
          title="No projects yet"
          body="Create a project first, then return here to add source media."
          action={
            <ButtonLink variant="primary" to="/projects/new">
              Create project
            </ButtonLink>
          }
        />
      ) : null}

      {!projectsQuery.loading && !projectsQuery.error && projectsQuery.items.length > 0 ? (
        <section className={styles.grid} aria-label="Project upload targets">
          {projectsQuery.items.map((project) => (
            <article className={styles.card} key={project.id}>
              <div className={styles.cardHeader}>
                <h2>
                  <Link to={`/projects/${encodeURIComponent(project.id)}`}>
                    {project.name}
                  </Link>
                </h2>
                <div className={styles.meta}>
                  <span>{project.status}</span>
                  <span>{project.visibility ?? "private"}</span>
                  <span>Updated {formatDate(project.updatedAt)}</span>
                </div>
              </div>
              <div className={styles.actions}>
                <ProjectUploadButton
                  projectId={project.id}
                  source="project_media_gallery"
                  label="Upload media"
                  busyLabel="Uploading..."
                  variant="primary"
                />
                <ButtonLink
                  variant="secondary"
                  to={`/projects/${encodeURIComponent(project.id)}/media`}
                >
                  View media
                </ButtonLink>
              </div>
            </article>
          ))}
          {projectsQuery.hasMore ? (
            <div className={styles.loadMore}>
              <Button
                variant="secondary"
                onClick={() => void projectsQuery.fetchNextPage()}
                disabled={projectsQuery.loadingMore}
                isLoading={projectsQuery.loadingMore}
              >
                Load more projects
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
